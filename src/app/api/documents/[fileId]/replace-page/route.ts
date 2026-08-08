import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { encryptBuffer, decryptBuffer, generateDek, encryptDek, decryptDek } from '@/lib/crypto';
import { authorizeApiRequest } from '@/lib/api-auth';
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

    // Auth (Zero-Trust Session + API Security)
    const authResult = await authorizeApiRequest(fileId, token, { httpMethod: req.method, action: 'edit' });
    if (authResult.errorResponse) {
      return authResult.errorResponse;
    }
    const { file } = authResult;
    if (!file.fileType?.includes('pdf')) {
      return NextResponse.json({ error: 'Page replacement only supported for PDFs' }, { status: 400 });
    }

    // Decrypt existing PDF
    const dek = (file as any).encryptedDek ? decryptDek((file as any).encryptedDek) : undefined;
    const originalBytes = decryptBuffer(
      file.encryptedContent!,
      file.iv!,
      file.authTag!,
      dek
    );

    // Use pdf-lib to replace the page
    const { PDFDocument } = await import('pdf-lib');
    const originalDoc = await PDFDocument.load(originalBytes);

    const replacementBytes = Buffer.from(replacementBase64, 'base64');
    const replacementDoc = await PDFDocument.load(replacementBytes);

    const [replacedPage] = await originalDoc.copyPages(replacementDoc, [0]);
    originalDoc.removePage(pageNumber - 1);
    originalDoc.insertPage(pageNumber - 1, replacedPage);

    const newPdfBytes = await originalDoc.save();
    const newBuf = Buffer.from(newPdfBytes);

    // Snapshot current → FileVersion
    const versionCount = await prisma.fileVersion.count({ where: { fileId } });
    await prisma.fileVersion.create({
      data: {
        fileId,
        versionNumber: versionCount + 1,
        encryptedContent: file.encryptedContent!,
        iv: file.iv!,
        authTag: file.authTag!,
        fileSize: file.fileSize,
        changeType: 'page_replace',
        changeDescription: `Replaced page ${pageNumber}`,
      },
    });

    // Encrypt and save new bytes
    const newDek = generateDek();
    const encrypted = encryptBuffer(newBuf, newDek);
    const encryptedDekStr = encryptDek(newDek);
    await prisma.userFile.update({
      where: { id: fileId },
      data: {
        encryptedContent: encrypted.encryptedContent,
        iv: encrypted.iv,
        authTag: encrypted.authTag,
        encryptedDek: encryptedDekStr,
        fileSize: newBuf.length,
      },
    });

    return NextResponse.json({ success: true, newVersion: versionCount + 1 });
  } catch (err) {
    console.error('[replace-page] error:', err);
    return NextResponse.json({ error: 'Failed to replace page' }, { status: 500 });
  }
}
