import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { decryptBytes, bytesToDataUrl } from '@/lib/encryptionService';
import { authorizeApiRequest } from '@/lib/api-auth';
import { decryptDek } from '@/lib/crypto';

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
    const authResult = await authorizeApiRequest(fileId, token);
    if (authResult.errorResponse) {
      return authResult.errorResponse;
    }
    const { file } = authResult;

    const dek = (file as any).encryptedDek ? decryptDek((file as any).encryptedDek) : undefined;
    const decrypted = decryptBytes({
      encryptedContent: file.encryptedContent,
      iv: file.iv,
      authTag: file.authTag,
    }, dek);

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
