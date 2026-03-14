import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { encryptBytes, dataUrlToBytes } from '@/lib/encryptionService';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/documents/[fileId]/save
 * Body: { token, dataUrl, changeDescription? }
 *
 * Re-encrypts the edited document and creates a FileVersion snapshot.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ fileId: string }> },
) {
  try {
    const { fileId } = await params;
    const body = await req.json() as {
      token: string;
      dataUrl: string;
      changeDescription?: string;
      changeType?: string;
    };

    const { token, dataUrl, changeDescription, changeType = 'collaborative_edit' } = body;
    if (!token || !dataUrl) return NextResponse.json({ error: 'Missing fields' }, { status: 400 });

    // Auth
    const link = await prisma.secureLink.findUnique({ where: { token } });
    if (!link || link.isRevoked || new Date() > link.expiresAt) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
    }

    const file = await prisma.userFile.findUnique({ where: { id: fileId } });
    if (!file || file.secureLinkId !== link.id) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    // Get current version count for numbering
    const versionCount = await prisma.fileVersion.count({ where: { fileId } });

    // Snapshot the CURRENT encrypted bytes as a version before overwriting
    await prisma.fileVersion.create({
      data: {
        fileId,
        versionNumber: versionCount + 1,
        encryptedContent: file.encryptedContent,
        iv: file.iv,
        authTag: file.authTag,
        fileSize: file.fileSize,
        changeType,
        changeDescription: changeDescription ?? 'Collaborative edit',
      },
    });

    // Re-encrypt the new content
    const rawBytes = dataUrlToBytes(dataUrl);
    const encrypted = encryptBytes(rawBytes);

    await prisma.userFile.update({
      where: { id: fileId },
      data: {
        encryptedContent: encrypted.encryptedContent,
        iv: encrypted.iv,
        authTag: encrypted.authTag,
        fileSize: rawBytes.length,
      },
    });

    return NextResponse.json({ success: true, versionNumber: versionCount + 1 });
  } catch (err) {
    console.error('[save] error:', err);
    return NextResponse.json({ error: 'Failed to save document' }, { status: 500 });
  }
}
