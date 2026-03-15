import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { buildEditorConfig, getOnlyOfficeServerUrl } from '@/lib/onlyoffice/config';

/**
 * GET /api/onlyoffice/editor-config/[fileId]?token=<share-token>
 *
 * Returns ONLYOFFICE editor config for an encrypted UserFile.
 * Authenticates via the share token (existing secure link flow).
 *
 * This is separate from /api/onlyoffice/config/[fileId] which works
 * with the new Document model. This endpoint works with the existing
 * encrypted UserFile model and secure link tokens.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ fileId: string }> }
) {
  try {
    const { fileId } = await params;
    const shareToken = request.nextUrl.searchParams.get('token');

    if (!shareToken) {
      return NextResponse.json({ error: 'Share token required' }, { status: 401 });
    }

    // ── Validate share token ────────────────────────────────────
    const secureLink = await prisma.secureLink.findUnique({
      where: { token: shareToken },
      select: {
        id: true,
        isUsed: true,
        isRevoked: true,
        expiresAt: true,
        otpVerifiedAt: true,
      },
    });

    if (!secureLink) {
      return NextResponse.json({ error: 'Invalid share token' }, { status: 401 });
    }

    if (secureLink.isRevoked) {
      return NextResponse.json({ error: 'Access has been revoked' }, { status: 403 });
    }

    if (new Date() > secureLink.expiresAt) {
      return NextResponse.json({ error: 'Link has expired' }, { status: 403 });
    }

    if (!secureLink.otpVerifiedAt) {
      return NextResponse.json({ error: 'OTP not verified' }, { status: 403 });
    }

    // ── Fetch file metadata ─────────────────────────────────────
    const userFile = await prisma.userFile.findFirst({
      where: {
        id: fileId,
        secureLinkId: secureLink.id,
      },
    });

    if (!userFile) {
      return NextResponse.json({ error: 'File not found' }, { status: 404 });
    }

    // ── Determine file extension ────────────────────────────────
    const ext = userFile.fileName.split('.').pop()?.toLowerCase() || 'docx';

    // ── Build base URL ──────────────────────────────────────────
    const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000';

    // ── Generate document key ───────────────────────────────────
    // Key must change when document changes to bust ONLYOFFICE cache
    const documentKey = `${userFile.id}_${userFile.createdAt.getTime()}`;

    // ── Build config ────────────────────────────────────────────
    // The file URL points to our decryption endpoint
    const config = buildEditorConfig({
      document: {
        fileId: userFile.id,
        fileName: userFile.fileName,
        fileType: ext,
        documentKey,
      },
      user: {
        id: 'viewer',
        name: 'Viewer',
      },
      baseUrl,
      mode: 'edit',
    });

    // Override the document URL to point to the encrypted-file endpoint
    config.document.url = `${baseUrl}/api/onlyoffice/file/${userFile.id}`;

    return NextResponse.json({
      config,
      serverUrl: getOnlyOfficeServerUrl(),
    });
  } catch (error) {
    console.error('[ONLYOFFICE EDITOR-CONFIG] Error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
