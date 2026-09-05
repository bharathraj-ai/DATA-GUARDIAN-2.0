import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { authorizeApiRequest } from '@/lib/api-auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/documents/[fileId]/versions?token=
 * Returns list of all saved versions for a file.
 *
 * POST /api/documents/[fileId]/versions
 * Body: { token, versionId }
 * Restores a specific historical version as the current document.
 */

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ fileId: string }> },
) {
  try {
    const { fileId } = await params;
    const token = req.nextUrl.searchParams.get('token');
    if (!token) return NextResponse.json({ error: 'Missing token' }, { status: 401 });

    const authResult = await authorizeApiRequest(fileId, token, { httpMethod: req.method, action: 'view' });
    if (authResult.errorResponse) {
      return authResult.errorResponse;
    }

    const versions = await prisma.fileVersion.findMany({
      where: { fileId },
      orderBy: { versionNumber: 'desc' },
      take: 50,
      select: {
        id: true,
        versionNumber: true,
        fileSize: true,
        changeType: true,
        changeDescription: true,
        createdBy: true,
        reason: true,
        previousVersionId: true,
        createdAt: true,
      },
    });

    return NextResponse.json({ success: true, versions });
  } catch (err) {
    console.error('[versions GET] error:', err);
    return NextResponse.json({ error: 'Failed to fetch versions' }, { status: 500 });
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ fileId: string }> },
) {
  try {
    const { fileId } = await params;
    const { token, versionId } = (await req.json()) as { token: string; versionId: string };

    if (!token || !versionId) return NextResponse.json({ error: 'Missing fields' }, { status: 400 });

    const authResult = await authorizeApiRequest(fileId, token, { httpMethod: req.method, action: 'edit', includeContent: true });
    if (authResult.errorResponse) {
      return authResult.errorResponse;
    }
    const { file } = authResult;

    // IDOR: version must belong to this file (already authorized)
    const { findFileVersionForFile } = await import('@/lib/security/resource-ownership');
    const ownedVersion = await findFileVersionForFile(versionId, fileId);
    if (!ownedVersion) {
      return NextResponse.json({ error: 'Version not found' }, { status: 404 });
    }

    const version = await prisma.fileVersion.findUnique({
      where: { id: ownedVersion.id },
      select: {
        id: true,
        versionNumber: true,
        encryptedContent: true,
        storageKey: true,
        iv: true,
        authTag: true,
        encryptedDek: true,
        fileSize: true,
      },
    });
    if (!version) {
      return NextResponse.json({ error: 'Version not found' }, { status: 404 });
    }

    if (!version.encryptedDek) {
      return NextResponse.json(
        { error: 'This version cannot be restored because it is missing its encryption key.' },
        { status: 409 },
      );
    }

    const {
      buildVersionSnapshot,
      createFileVersionRow,
      loadVersionCiphertext,
      persistLiveCiphertext,
    } = await import('@/lib/file-version-store');

    const restoredBytes = await loadVersionCiphertext(version);
    if (!restoredBytes) {
      return NextResponse.json({ error: 'Version ciphertext is missing' }, { status: 404 });
    }

    const snapshot = await buildVersionSnapshot(file as never, { moveLiveObject: true });
    const versionCount = await prisma.fileVersion.count({ where: { fileId } });
    if (snapshot) {
      await createFileVersionRow({
        fileId,
        versionNumber: versionCount + 1,
        snapshot,
        changeType: 'restore',
        changeDescription: `Pre-restore snapshot before restoring v${version.versionNumber}`,
      });
    }

    const ext = (file.fileName || 'document.bin').split('.').pop() || 'bin';
    await persistLiveCiphertext({
      fileId,
      fileName: file.fileName || 'document',
      mimeType: file.fileType || 'application/octet-stream',
      fileExtension: ext,
      ciphertext: restoredBytes,
      iv: version.iv,
      authTag: version.authTag,
      encryptedDek: version.encryptedDek,
      plaintextSize: version.fileSize,
      existingMongoFileId: (file as { mongoFileId?: string | null }).mongoFileId,
    });

    return NextResponse.json({ success: true, restoredVersion: version.versionNumber });
  } catch (err) {
    console.error('[versions POST] error:', err);
    return NextResponse.json({ error: 'Failed to restore version' }, { status: 500 });
  }
}
