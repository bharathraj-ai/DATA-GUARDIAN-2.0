import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { decryptBuffer, decryptDek } from '@/lib/crypto';
import { authorizeApiRequest } from '@/lib/api-auth';

function bytesToDataUrl(bytes: Buffer, mimeType: string): string {
  return `data:${mimeType};base64,${bytes.toString('base64')}`;
}

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

    // Verify token → session → link → file ownership
    const authResult = await authorizeApiRequest(fileId, token, { httpMethod: req.method, action: 'preview' });
    if (authResult.errorResponse) {
      return authResult.errorResponse;
    }
    const { file } = authResult;

    let encryptedBytes = file.encryptedContent;
    if (!encryptedBytes && (file as any).mongoFile?.gridFSId) {
        const { downloadFromMongo } = await import('@/lib/mongo/operations');
        encryptedBytes = await downloadFromMongo((file as any).mongoFile.gridFSId);
    }

    if (!encryptedBytes) {
        return NextResponse.json({ error: 'File content not found in any storage backend' }, { status: 404 });
    }

    const dek = (file as any).encryptedDek ? decryptDek((file as any).encryptedDek) : undefined;
    const decrypted = decryptBuffer(
      encryptedBytes,
      file.iv!,
      file.authTag!,
      dek
    );

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
