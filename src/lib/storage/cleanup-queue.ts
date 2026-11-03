/**
 * Storage Cleanup Queue — Durable outbox for deferred GridFS deletion.
 *
 * Why this exists:
 *   GridFS objects MUST NOT be deleted inside a Prisma transaction, because if
 *   the transaction rolls back the database record still points to the deleted
 *   object, causing permanent data loss.
 *
 * Pattern used:
 *   1. Inside the transaction: write a StorageCleanupTask row (pending deletion).
 *   2. After the transaction commits: call processCleanupQueue() to execute the
 *      actual GridFS deletes with retries.
 *
 * Guarantees:
 *   - A GridFS object is never deleted while any active DB record still references it.
 *   - A cleanup failure is never swallowed silently — it is persisted and retried.
 *   - processCleanupQueue() is idempotent and safe to call concurrently.
 */

import { prisma } from '@/lib/prisma';
import { logger } from '@/lib/logger';

export const CLEANUP_MAX_ATTEMPTS = 5;
const CLEANUP_BATCH = 50;

/**
 * Schedule a GridFS object for deferred deletion.
 * Call this INSIDE a Prisma transaction so the record is written atomically
 * with the DB change that obsoletes the GridFS object.
 *
 * @param tx  Prisma transaction client (or global prisma for post-commit)
 * @param storageFileId  GridFS ObjectId string
 * @param reason  Human-readable reason (e.g. 'pruned_version', 'rollback')
 */
export async function scheduleGridFSCleanup(
  tx: Parameters<Parameters<typeof prisma.$transaction>[0]>[0] | typeof prisma,
  storageFileId: string,
  reason: string = 'pruned_version',
  bucketName: string = 'data_guardian_files'
): Promise<void> {
  await (tx as any).storageCleanupTask.create({
    data: {
      storageFileId,
      bucketName,
      reason,
      status: 'PENDING',
    },
  });
}

/**
 * Processes all PENDING StorageCleanupTasks.
 *
 * Safety:
 *  - Before deleting, verifies no active DB record still references the GridFS ID.
 *  - On GridFS error, increments retries; marks FAILED after maxAttempts.
 *  - Uses UPDATE … WHERE status='PENDING' to prevent concurrent workers from
 *    double-processing the same task.
 *
 * @param maxItems  Maximum tasks to process in one call (default 50)
 * @returns { processed, deleted, skipped, failed }
 */
export async function processCleanupQueue(maxItems = CLEANUP_BATCH): Promise<{
  processed: number;
  deleted: number;
  skipped: number;
  failed: number;
}> {
  const now = new Date();
  let processed = 0;
  let deleted = 0;
  let skipped = 0;
  let failed = 0;

  // Claim a batch of PENDING tasks atomically
  const tasks = await prisma.storageCleanupTask.findMany({
    where: { status: 'PENDING', attempts: { lt: CLEANUP_MAX_ATTEMPTS } },
    orderBy: { createdAt: 'asc' },
    take: maxItems,
  });

  for (const task of tasks) {
    // Mark as IN_PROGRESS (optimistic lock — skip if already claimed by another worker)
    const claimed = await prisma.storageCleanupTask.updateMany({
      where: { id: task.id, status: 'PENDING' },
      data: { status: 'IN_PROGRESS', lastAttemptAt: now, attempts: { increment: 1 } },
    });
    if (claimed.count === 0) continue; // Claimed by another worker
    processed++;

    try {
      // Safety check: ensure no active DB record still references this file
      const isReferenced = await isGridFSFileReferenced(task.storageFileId);
      if (isReferenced) {
        logger.warn(`[CleanupQueue] Skipping deletion of ${task.storageFileId} — still referenced in DB`);
        await prisma.storageCleanupTask.update({
          where: { id: task.id },
          data: { status: 'PENDING', errorMessage: 'File still referenced — deferred' },
        });
        skipped++;
        continue;
      }

      // Execute GridFS deletion
      const { getStorageProvider } = await import('./storage-provider');
      await getStorageProvider().delete(task.storageFileId);

      await prisma.storageCleanupTask.update({
        where: { id: task.id },
        data: { status: 'COMPLETED', completedAt: now },
      });
      deleted++;

      logger.info(`[CleanupQueue] Deleted GridFS object ${task.storageFileId} (reason: ${task.reason})`);
    } catch (err: any) {
      const nextAttempts = task.attempts + 1;
      const isFinal = nextAttempts >= CLEANUP_MAX_ATTEMPTS;

      await prisma.storageCleanupTask.update({
        where: { id: task.id },
        data: {
          status: isFinal ? 'FAILED' : 'PENDING',
          errorMessage: err?.message?.slice(0, 500) ?? 'Unknown error',
        },
      });

      if (isFinal) {
        logger.error(`[CleanupQueue] FAILED to delete GridFS object ${task.storageFileId} after ${nextAttempts} attempts:`, err);
        failed++;
      } else {
        logger.warn(`[CleanupQueue] Attempt ${nextAttempts}/${CLEANUP_MAX_ATTEMPTS} failed for ${task.storageFileId}: ${err?.message}`);
      }
    }
  }

  return { processed, deleted, skipped, failed };
}

/**
 * Checks all four PostgreSQL models that can reference a GridFS object.
 * Returns true if ANY active record still references the given storageFileId.
 * Also checks legacy mongoFile.gridFSId references.
 *
 * This is the safety guard that prevents deleting still-referenced objects.
 */
export async function isGridFSFileReferenced(storageFileId: string): Promise<boolean> {
  try {
    const [docRef, docVerRef, userFileRef, fileVerRef, mongoFileRef] = await Promise.all([
      prisma.document.findFirst({
        where: { storageFileId, isDeleted: false },
        select: { id: true },
      }),
      prisma.documentVersion.findFirst({
        where: { storageFileId },
        select: { id: true },
      }),
      prisma.userFile.findFirst({
        where: { storageFileId },
        select: { id: true },
      }),
      prisma.fileVersion.findFirst({
        where: { storageFileId },
        select: { id: true },
      }),
      // Legacy: gridFSId in MongoFile table (old upload path)
      prisma.mongoFile.findFirst({
        where: { gridFSId: storageFileId, isDeleted: false },
        select: { id: true },
      }),
    ]);
    return !!(docRef || docVerRef || userFileRef || fileVerRef || mongoFileRef);
  } catch (err) {
    // Fail closed: if we can't verify references, treat as referenced
    logger.error('[CleanupQueue] isGridFSFileReferenced query failed — treating as referenced (fail-closed)', err);
    return true;
  }
}

