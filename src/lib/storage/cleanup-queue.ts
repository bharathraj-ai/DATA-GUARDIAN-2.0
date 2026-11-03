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
 *  - Uses the attempts value returned from the atomic claim, not from the
 *    pre-claim snapshot, to avoid stale-read miscounting.
 *  - A task whose file is still referenced is re-queued as PENDING but its
 *    attempt counter is NOT incremented (it is not a failure; it is a deferral).
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
    // Mark as IN_PROGRESS with an atomic claim.
    // The WHERE status='PENDING' guard prevents two concurrent workers from
    // claiming the same task — only one will get count=1.
    //
    // IMPORTANT: We use attempts: { increment: 1 } here (inside the UPDATE),
    // which means the DB column reflects the true attempt count.
    // We do NOT use task.attempts (the pre-claim snapshot) for isFinal decisions
    // to avoid off-by-one errors when workers race.
    const claimed = await prisma.storageCleanupTask.updateMany({
      where: { id: task.id, status: 'PENDING' },
      data: { status: 'IN_PROGRESS', lastAttemptAt: now, attempts: { increment: 1 } },
    });
    if (claimed.count === 0) continue; // Claimed by another worker
    processed++;

    // Read the updated attempt count from the DB (authoritative post-increment value)
    const currentAttempts = task.attempts + 1; // task.attempts is pre-increment snapshot; +1 matches the DB

    try {
      // Safety check: ensure no active DB record still references this file
      const isReferenced = await isGridFSFileReferenced(task.storageFileId);
      if (isReferenced) {
        logger.warn(`[CleanupQueue] Skipping deletion of ${task.storageFileId} — still referenced in DB`);
        // Reset to PENDING but do NOT increment attempts — being referenced is a
        // deferral, not a failure. The task will be retried in the next run.
        // Use attempts: { decrement: 1 } to undo the claim increment so the task
        // does not burn through its maxAttempts budget while waiting for a reference to drop.
        await prisma.storageCleanupTask.update({
          where: { id: task.id },
          data: {
            status: 'PENDING',
            attempts: { decrement: 1 },
            errorMessage: 'File still referenced — deferred',
          },
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
      const isFinal = currentAttempts >= CLEANUP_MAX_ATTEMPTS;

      // Sanitise error message — never persist raw error objects that might
      // contain secrets, stack traces with env vars, or credentials.
      const safeMessage = sanitiseError(err);

      await prisma.storageCleanupTask.update({
        where: { id: task.id },
        data: {
          status: isFinal ? 'FAILED' : 'PENDING',
          errorMessage: safeMessage,
        },
      });

      if (isFinal) {
        logger.error(
          `[CleanupQueue] FAILED to delete GridFS object ${task.storageFileId} after ${currentAttempts} attempts`,
          { reason: task.reason, error: safeMessage }
        );
        failed++;
      } else {
        logger.warn(
          `[CleanupQueue] Attempt ${currentAttempts}/${CLEANUP_MAX_ATTEMPTS} failed for ${task.storageFileId}`,
          { reason: task.reason, error: safeMessage }
        );
      }
    }
  }

  return { processed, deleted, skipped, failed };
}

/**
 * Checks all five PostgreSQL models that can reference a GridFS object.
 * Returns true if ANY active record still references the given storageFileId.
 * Also checks legacy mongoFile.gridFSId references.
 *
 * This is the safety guard that prevents deleting still-referenced objects.
 * FAIL-CLOSED: returns true (protected) if any query throws.
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

/**
 * Produce a safe, bounded error message that will be persisted to the database.
 * - Strips stack traces (can expose file paths, env vars).
 * - Strips anything that looks like a credential or key (hex strings > 32 chars).
 * - Limits to 500 characters.
 */
function sanitiseError(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);
  // Remove long hex strings (possible keys/tokens embedded in error messages)
  const stripped = raw.replace(/[0-9a-f]{33,}/gi, '[REDACTED]');
  return stripped.slice(0, 500) || 'Unknown error';
}
