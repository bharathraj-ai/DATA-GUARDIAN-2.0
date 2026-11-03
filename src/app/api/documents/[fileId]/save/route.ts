import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { encryptBuffer, generateDek, encryptDek } from '@/lib/crypto';
import { authorizeApiRequest } from '@/lib/api-auth';
import { checkUploadRateLimit, extractClientIP } from '@/lib/rate-limit';
import { headers } from 'next/headers';
import { logger } from '@/lib/logger';
import { scheduleGridFSCleanup, processCleanupQueue, assertStorageFileAvailable } from '@/lib/storage/cleanup-queue';

function dataUrlToBytes(dataUrl: string): Buffer {
  const base64 = dataUrl.split(',')[1] || dataUrl;
  return Buffer.from(base64, 'base64');
}

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
  let uploadResult: any = null;
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

    const MAX_DECODED_BYTES = 50 * 1024 * 1024;
    if (dataUrl.length > MAX_DECODED_BYTES * 2) {
      return NextResponse.json({ error: 'Payload too large' }, { status: 413 });
    }

    // Auth (Zero-Trust Session + API Security)
    const authResult = await authorizeApiRequest(fileId, token, { httpMethod: req.method, action: 'edit', includeContent: true });
    if (authResult.errorResponse) {
      return authResult.errorResponse;
    }
    const { requireHeldEditLock } = await import('@/lib/collaboration/edit-lock-http');
    const lockGate = await requireHeldEditLock(authResult, (body as { clientInstanceId?: string }).clientInstanceId);
    if ('errorResponse' in lockGate) return lockGate.errorResponse;
    const { file } = authResult;

    // ── Rate Limit check ─────────────────────────────────────────
    const requestHeaders = await headers();
    const clientIP = extractClientIP(requestHeaders);
    const rateLimit = await checkUploadRateLimit(clientIP);
    if (!rateLimit.allowed) {
      return NextResponse.json({ error: 'Rate limit exceeded for saves. Please try again later.' }, { status: 429 });
    }

    const rawBytes = dataUrlToBytes(dataUrl);
    if (rawBytes.length > MAX_DECODED_BYTES) {
      return NextResponse.json({ error: 'Decoded document exceeds size limit' }, { status: 413 });
    }
    const newDek = generateDek();
    const encrypted = encryptBuffer(rawBytes, newDek);
    const encryptedDekStr = encryptDek(newDek);

    // Save ciphertext in centralized MongoDB GridFS storage (zero full buffers in PostgreSQL)
    const { getStorageProvider } = await import('@/lib/storage/storage-provider');
    const storageProvider = getStorageProvider();
    uploadResult = await storageProvider.upload(
      encrypted.encryptedContent,
      file.fileName || 'document.bin',
      {
        metadata: {
          fileId,
          version: (file.version || 1) + 1,
          mimeType: file.fileType,
          encryptionAlgorithm: 'aes-256-gcm',
          encryptionIV: encrypted.iv,
          authenticationTag: encrypted.authTag,
          encryptedDEK: encryptedDekStr,
        },
      }
    );

    // IDs of pruned versions whose GridFS objects need deferred deletion
    const prunedGridFSIds: string[] = [];

    let versionNumber = 0;
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        versionNumber = await prisma.$transaction(async (tx) => {
          // COORDINATION GUARD: Verify newly uploaded storageFileId is available and not tombstoned
          await assertStorageFileAvailable(uploadResult.storageFileId, tx);

          const agg = await tx.fileVersion.aggregate({
            where: { fileId },
            _max: { versionNumber: true },
          });
          const next = (agg._max.versionNumber ?? 0) + 1;
          await tx.fileVersion.create({
            data: {
              fileId,
              versionNumber: next,
              encryptedContent: null, // Full file stored in MongoDB GridFS
              storageProvider: storageProvider.providerName,
              storageFileId: (file as any).storageFileId || file.mongoFile?.gridFSId || null,
              iv: file.iv!,
              authTag: file.authTag!,
              encryptedDek: file.encryptedDek,
              fileSize: file.fileSize,
              changeType,
              changeDescription: changeDescription ?? 'Collaborative edit',
            },
          });
          await tx.userFile.update({
            where: { id: fileId },
            data: {
              encryptedContent: null, // Full file stored in MongoDB GridFS
              storageProvider: storageProvider.providerName,
              storageFileId: uploadResult.storageFileId,
              iv: encrypted.iv,
              authTag: encrypted.authTag,
              encryptedDek: encryptedDekStr,
              fileSize: rawBytes.length,
            },
          });

          // SECURITY: Cap FileVersion history to 10 versions to prevent unbounded DB growth.
          // IMPORTANT: GridFS objects must NOT be deleted inside a transaction.
          // Instead, we record them in the StorageCleanupTask outbox (also inside the
          // transaction) so deletion is deferred until AFTER the transaction commits.
          const MAX_VERSIONS = 10;
          const versionCount = await tx.fileVersion.count({ where: { fileId } });
          if (versionCount > MAX_VERSIONS) {
            const versionsToDelete = await tx.fileVersion.findMany({
              where: { fileId },
              orderBy: { versionNumber: 'asc' },
              take: versionCount - MAX_VERSIONS,
              select: { id: true, storageFileId: true },
            });
            await tx.fileVersion.deleteMany({
              where: { id: { in: versionsToDelete.map(v => v.id) } },
            });
            // Schedule deferred GridFS cleanup (written inside tx, executed after commit)
            for (const v of versionsToDelete) {
              if (v.storageFileId) {
                prunedGridFSIds.push(v.storageFileId);
                await scheduleGridFSCleanup(tx, v.storageFileId, 'pruned_version');
              }
            }
          }

          return next;
        });
        break;
      } catch (e: unknown) {
        const code = typeof e === 'object' && e !== null && 'code' in e ? (e as { code?: string }).code : '';
        if (code === 'P2002' && attempt < 4) continue;
        throw e;
      }
    }

    if (versionNumber === 0) {
      // Transaction failed entirely — schedule rollback cleanup for the uploaded GridFS object
      if (uploadResult?.storageFileId) {
        await scheduleGridFSCleanup(prisma, uploadResult.storageFileId, 'rollback').catch((e) =>
          logger.error('[save] Failed to schedule rollback cleanup:', e)
        );
        void processCleanupQueue(1).catch(() => {});
      }
      return NextResponse.json({ error: 'Could not persist document version' }, { status: 503 });
    }

    // ── Post-commit: execute deferred GridFS deletions (non-blocking) ───
    // Transaction has committed. Now safe to delete pruned GridFS objects.
    if (prunedGridFSIds.length > 0) {
      void processCleanupQueue(prunedGridFSIds.length + 5).catch((e) =>
        logger.warn('[save] Background cleanup queue processing failed:', e)
      );
    }

    return NextResponse.json({ success: true, versionNumber });
  } catch (err) {
    logger.error('[save] error:', err);
    if (uploadResult?.storageFileId) {
      // Schedule cleanup rather than fire-and-forget .catch(() => {})
      await scheduleGridFSCleanup(prisma, uploadResult.storageFileId, 'rollback').catch((e) =>
        logger.error('[save] Failed to schedule rollback cleanup:', e)
      );
      void processCleanupQueue(1).catch(() => {});
    }
    return NextResponse.json({ error: 'Failed to save document' }, { status: 500 });
  }
}
