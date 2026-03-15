import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { decryptBuffer } from '@/lib/crypto';
import { verifyOnlyOfficeToken, extractBearerToken } from '@/lib/onlyoffice/jwt';

/**
 * GET /api/onlyoffice/file/[fileId]
 *
 * Serves decrypted UserFile content to the ONLYOFFICE Document Server.
 *
 * Authentication: JWT Bearer token (set by our config builder)
 * This endpoint is ONLY callable by the ONLYOFFICE server — never by browsers directly.
 *
 * The JWT payload must contain { fileId, token } matching the request.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ fileId: string }> }
) {
  try {
    const { fileId } = await params;

    // ── Verify ONLYOFFICE JWT ───────────────────────────────────
    const authHeader = request.headers.get('authorization');
    const jwtToken = extractBearerToken(authHeader);

    // Also check query param (ONLYOFFICE sometimes sends token as query)
    const queryToken = request.nextUrl.searchParams.get('token');
    const tokenToVerify = jwtToken || queryToken;

    if (!tokenToVerify) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    }

    try {
      const payload = verifyOnlyOfficeToken(tokenToVerify);
      // Verify the token was issued for this specific file
      const doc = payload.document as { key?: string } | undefined;
      if (doc?.key && !String(doc.key).startsWith(fileId)) {
        return NextResponse.json({ error: 'Token file mismatch' }, { status: 403 });
      }
    } catch {
      return NextResponse.json({ error: 'Invalid or expired token' }, { status: 401 });
    }

    // ── Fetch encrypted file from DB ────────────────────────────
    const userFile = await prisma.userFile.findUnique({
      where: { id: fileId },
    });

    if (!userFile) {
      return NextResponse.json({ error: 'File not found' }, { status: 404 });
    }

    // ── Decrypt file content ────────────────────────────────────
    const decrypted = decryptBuffer(
      Buffer.from(userFile.encryptedContent),
      userFile.iv,
      userFile.authTag
    );

    // ── Determine MIME type ─────────────────────────────────────
    const mimeMap: Record<string, string> = {
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/msword': 'application/msword',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/vnd.ms-excel': 'application/vnd.ms-excel',
      'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      'application/vnd.ms-powerpoint': 'application/vnd.ms-powerpoint',
      'application/pdf': 'application/pdf',
    };

    const contentType = mimeMap[userFile.fileType] || userFile.fileType || 'application/octet-stream';

    // ── Stream decrypted content ────────────────────────────────
    return new NextResponse(new Uint8Array(decrypted), {
      status: 200,
      headers: {
        'Content-Type': contentType,
        'Content-Length': decrypted.length.toString(),
        'Content-Disposition': `inline; filename="${encodeURIComponent(userFile.fileName)}"`,
        'Cache-Control': 'no-store, no-cache, must-revalidate',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch (error) {
    console.error('[ONLYOFFICE FILE] Error serving file:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
