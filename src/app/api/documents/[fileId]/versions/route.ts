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
      select: {
        id: true,
        versionNumber: true,
        fileSize: true,
        changeType: true,
        changeDescription: true,
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

    const authResult = await authorizeApiRequest(fileId, token, { httpMethod: req.method, action: 'edit' });
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

    const version = await prisma.fileVersion.findUnique({ where: { id: ownedVersion.id } });
    if (!version) {
      return NextResponse.json({ error: 'Version not found' }, { status: 404 });
    }

    // Snapshot current state before restore
    const versionCount = await prisma.fileVersion.count({ where: { fileId } });
    await prisma.fileVersion.create({
      data: {
        fileId,
        versionNumber: versionCount + 1,
        encryptedContent: file.encryptedContent!,
        iv: file.iv!,
        authTag: file.authTag!,
        fileSize: file.fileSize,
        changeType: 'restore',
        changeDescription: `Pre-restore snapshot before restoring v${version.versionNumber}`,
      },
    });

    // Restore the old version bytes
    await prisma.userFile.update({
      where: { id: fileId },
      data: {
        encryptedContent: version.encryptedContent,
        iv: version.iv,
        authTag: version.authTag,
        fileSize: version.fileSize,
      },
    });

    return NextResponse.json({ success: true, restoredVersion: version.versionNumber });
  } catch (err) {
    console.error('[versions POST] error:', err);
    return NextResponse.json({ error: 'Failed to restore version' }, { status: 500 });
  }
}
