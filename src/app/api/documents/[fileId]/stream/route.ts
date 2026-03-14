import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { decryptBytes, bytesToDataUrl } from '@/lib/encryptionService';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/documents/[fileId]/stream?token=<shareToken>
 *
 * Verifies the OTP session is valid, decrypts the file server-side,
 * and returns it as a base64 data-URL in JSON (never as an attachment).
 * The browser cannot trigger a native download from this response.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ fileId: string }> },
) {
  try {
    const { fileId } = await params;
    const token = req.nextUrl.searchParams.get('token');
    if (!token) return NextResponse.json({ error: 'Missing token' }, { status: 401 });

    // Verify token → link → file ownership
    const link = await prisma.secureLink.findUnique({ where: { token } });
    if (!link) return NextResponse.json({ error: 'Invalid token' }, { status: 401 });
    if (link.isRevoked) return NextResponse.json({ error: 'Link revoked' }, { status: 403 });
    if (new Date() > link.expiresAt) return NextResponse.json({ error: 'Link expired' }, { status: 403 });

    const file = await prisma.userFile.findUnique({ where: { id: fileId } });
    if (!file) return NextResponse.json({ error: 'File not found' }, { status: 404 });
    if (file.secureLinkId !== link.id) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

    const decrypted = decryptBytes({
      encryptedContent: file.encryptedContent,
      iv: file.iv,
      authTag: file.authTag,
    });

    const dataUrl = bytesToDataUrl(decrypted, file.fileType || 'application/octet-stream');

    return NextResponse.json(
      { success: true, dataUrl, fileName: file.fileName, fileType: file.fileType, fileSize: file.fileSize },
      {
        headers: {
          'Cache-Control': 'no-store, no-cache, must-revalidate',
          'Content-Security-Policy': "default-src 'none'",
        },
      },
    );
  } catch (err) {
    console.error('[stream] error:', err);
    return NextResponse.json({ error: 'Failed to stream file' }, { status: 500 });
  }
}
