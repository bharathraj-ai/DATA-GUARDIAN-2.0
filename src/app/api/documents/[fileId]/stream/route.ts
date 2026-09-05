import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { decryptBuffer } from '@/lib/crypto';
import { unwrapDek } from '@/lib/security/kms';
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

    // Full data-URL is download-equivalent — require download, not edit-as-bypass.
    const authResult = await authorizeApiRequest(fileId, token, {
      httpMethod: req.method,
      action: 'download',
      includeContent: true,
    });
    if (authResult.errorResponse) {
      return authResult.errorResponse;
    }
    const { file } = authResult;
    if (!file) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    let encryptedBytes = file.encryptedContent;
    if (!encryptedBytes && (file as any).mongoFile?.gridFSId) {
        const { downloadLiveObject } = await import('@/lib/blob-store');
        encryptedBytes = await downloadLiveObject((file as any).mongoFile.gridFSId);
    }

    if (!encryptedBytes) {
        return NextResponse.json({ error: 'File content not found in any storage backend' }, { status: 404 });
    }

    const dek = (file as any).encryptedDek ? await unwrapDek((file as any).encryptedDek) : undefined;
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
