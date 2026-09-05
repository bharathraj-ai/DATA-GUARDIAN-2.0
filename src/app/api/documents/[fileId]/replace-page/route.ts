import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { encryptBuffer, generateDek } from '@/lib/crypto';
import { authorizeApiRequest } from '@/lib/api-auth';
import { decryptUserFileBytes } from '@/lib/decrypt-user-file';
import {
  buildVersionSnapshot,
  createFileVersionRow,
  persistLiveCiphertext,
} from '@/lib/file-version-store';
export const dynamic = 'force-dynamic';

/**
 * POST /api/documents/[fileId]/replace-page
 * Body: { token, pageNumber, replacementBase64 }
 *
 * Uses pdf-lib to splice in a replacement page and saves a new version.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ fileId: string }> },
) {
  try {
    const { fileId } = await params;
    const body = (await req.json()) as {
      token: string;
      pageNumber: number;
      replacementBase64: string; // base64 of the replacement PDF page
    };
    const { token, pageNumber, replacementBase64 } = body;
    if (!token || !pageNumber || !replacementBase64) {
      return NextResponse.json({ error: 'Missing fields' }, { status: 400 });
    }

    const authResult = await authorizeApiRequest(fileId, token, { httpMethod: req.method, action: 'edit', includeContent: true });
    if (authResult.errorResponse) {
      return authResult.errorResponse;
    }
    const { requireHeldEditLock } = await import('@/lib/collaboration/edit-lock-http');
    const lockGate = await requireHeldEditLock(authResult, (body as { clientInstanceId?: string }).clientInstanceId);
    if ('errorResponse' in lockGate) return lockGate.errorResponse;
    const { file } = authResult;
    if (!file.fileType?.includes('pdf')) {
      return NextResponse.json({ error: 'Page replacement only supported for PDFs' }, { status: 400 });
    }

    const originalBytes = await decryptUserFileBytes(file as never);

    const { PDFDocument } = await import('pdf-lib');
    const originalDoc = await PDFDocument.load(originalBytes);

    const replacementBytes = Buffer.from(replacementBase64, 'base64');
    const replacementDoc = await PDFDocument.load(replacementBytes);

    const [replacedPage] = await originalDoc.copyPages(replacementDoc, [0]);
    originalDoc.removePage(pageNumber - 1);
    originalDoc.insertPage(pageNumber - 1, replacedPage);

    const newPdfBytes = await originalDoc.save();
    const newBuf = Buffer.from(newPdfBytes);

    const snapshot = await buildVersionSnapshot(file as never, { moveLiveObject: true });
    const versionCount = await prisma.fileVersion.count({ where: { fileId } });
    if (snapshot) {
      await createFileVersionRow({
        fileId,
        versionNumber: versionCount + 1,
        snapshot,
        changeType: 'page_replace',
        changeDescription: `Replaced page ${pageNumber}`,
      });
    }

    const newDek = generateDek();
    const encrypted = encryptBuffer(newBuf, newDek);
    const { wrapDekForLink } = await import('@/lib/security/kms');
    const encryptedDekStr = await wrapDekForLink(newDek, authResult.secureLink.id);
    const ext = (file.fileName || 'document.pdf').split('.').pop() || 'pdf';
    await persistLiveCiphertext({
      fileId,
      fileName: file.fileName || 'document.pdf',
      mimeType: file.fileType || 'application/pdf',
      fileExtension: ext,
      ciphertext: encrypted.encryptedContent,
      iv: encrypted.iv,
      authTag: encrypted.authTag,
      encryptedDek: encryptedDekStr,
      plaintextSize: newBuf.length,
      existingMongoFileId: (file as { mongoFileId?: string | null }).mongoFileId,
    });

    return NextResponse.json({ success: true, newVersion: versionCount + 1 });
  } catch (err) {
    console.error('[replace-page] error:', err);
    return NextResponse.json({ error: 'Failed to replace page' }, { status: 500 });
  }
}
