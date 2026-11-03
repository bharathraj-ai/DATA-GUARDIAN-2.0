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
 *   - Stale IN_PROGRESS tasks (worker crash) are recovered after LEASE_TIMEOUT_MS.
 *   - The correct GridFS bucket (from task.bucketName) is always used for deletion.
 *   - Error messages are sanitised before persistence (no keys/tokens/stack traces).
 *
 * Race-condition coordination:
 *   The atomic claim (WHERE status='PENDING' AND claimedAt IS NULL) serves as a
 *   tombstone from the upload side's perspective via isGridFSFileReferenced().
 *   Upload code that reuses an existing GridFS object ID should call
 *   isGridFSObjectScheduledForDeletion() before writing a new DB reference.
 *   This prevents: cleanup deletes object → upload writes reference → 404.
 */

import { prisma } from '@/lib/prisma';
import { logger } from '@/lib/logger';

export const CLEANUP_MAX_ATTEMPTS = 5;
const CLEANUP_BATCH = 50;

/**
 * Lease timeout in milliseconds.
 * If a worker holds IN_PROGRESS for longer than this, it is assumed crashed
 * and the task is eligible for recovery by another worker.
 *
 * Default: 10 minutes. Override with env var CLEANUP_LEASE_TIMEOUT_MS.
 */
export const CLEANUP_LEASE_TIMEOUT_MS =
  parseInt(process.env.CLEANUP_LEASE_TIMEOUT_MS || '600000', 10);

// ─── Scheduling ────────────────────────────────────────────────────────────

/**
 * Schedule a GridFS object for deferred deletion.
 * Call this INSIDE a Prisma transaction so the record is written atomically
 * with the DB change that obsoletes the GridFS object.
 *
 * @param tx  Prisma transaction client (or global prisma for post-commit)
 * @param storageFileId  GridFS ObjectId string
 * @param reason  Human-readable reason (e.g. 'pruned_version', 'rollback')
 * @param bucketName  GridFS bucket; defaults to data_guardian_files
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

// ─── Stale-task recovery ───────────────────────────────────────────────────

/**
 * Recovers IN_PROGRESS tasks whose lease has expired.
 *
 * A worker that crashes after claiming a task leaves it IN_PROGRESS forever.
 * This function finds such tasks and resets them to PENDING for retry.
 *
 * Safety:
 *  - Only resets tasks older than CLEANUP_LEASE_TIMEOUT_MS.
 *  - Uses updateMany WHERE to prevent a live worker from having its task stolen.
 *  - If a live worker's DB update arrives after recovery, it will find the task
 *    already reclaimed (status !== IN_PROGRESS) and its update becomes a no-op
 *    because we use WHERE status='IN_PROGRESS' for completion too.
 *  - Tasks that have reached maxAttempts are marked FAILED, not reset to PENDING.
 *
 * @param leaseTimeoutMs  Lease duration (default: CLEANUP_LEASE_TIMEOUT_MS)
 * @returns { recovered, markedFailed }
 */
export async function recoverStaleCleanupTasks(
  leaseTimeoutMs = CLEANUP_LEASE_TIMEOUT_MS
): Promise<{ recovered: number; markedFailed: number }> {
  const leaseExpiry = new Date(Date.now() - leaseTimeoutMs);
  let recovered = 0;
  let markedFailed = 0;

  // Find expired IN_PROGRESS tasks
  const staleTasks = await prisma.storageCleanupTask.findMany({
    where: {
      status: 'IN_PROGRESS',
      claimedAt: { lt: leaseExpiry },
    },
    select: { id: true, attempts: true },
  });

  for (const task of staleTasks) {
    const isFinal = task.attempts >= CLEANUP_MAX_ATTEMPTS;

    const updated = await prisma.storageCleanupTask.updateMany({
      where: { id: task.id, status: 'IN_PROGRESS', claimedAt: { lt: leaseExpiry } },
      data: {
        status: isFinal ? 'FAILED' : 'PENDING',
        errorMessage: isFinal
          ? `Exceeded max attempts (${CLEANUP_MAX_ATTEMPTS}) — lease expired`
          : 'Worker lease expired — recovered for retry',
        claimedAt: null,
      },
    });

    if (updated.count > 0) {
      if (isFinal) {
        markedFailed++;
        logger.error('[CleanupQueue] Stale task marked FAILED after max attempts', {
          taskId: task.id,
          attempts: task.attempts,
        });
      } else {
        recovered++;
        logger.warn('[CleanupQueue] Recovered stale IN_PROGRESS task for retry', {
          taskId: task.id,
          attempts: task.attempts,
        });
      }
    }
  }

  return { recovered, markedFailed };
}

// ─── Processing ─────────────────────────────────────────────────────────────

/**
 * Processes all PENDING StorageCleanupTasks.
 *
 * Safety:
 *  - Runs recoverStaleCleanupTasks() first to unblock crashed-worker tasks.
 *  - Before deleting, verifies no active DB record still references the GridFS ID.
 *  - On GridFS error, increments retries; marks FAILED after maxAttempts.
 *  - Atomic claim (WHERE status='PENDING') prevents concurrent double-processing.
 *  - claimedAt timestamp enables lease-expiry recovery.
 *  - Uses the correct bucket from task.bucketName (not the global default).
 *  - A task whose file is still referenced is re-queued without consuming retry budget.
 *  - Completion update uses WHERE status='IN_PROGRESS' so a stale recovered worker
 *    cannot overwrite a newer task state.
 *
 * @param maxItems  Maximum tasks to process in one call (default 50)
 * @returns { processed, deleted, skipped, failed, recovered }
 */
export async function processCleanupQueue(maxItems = CLEANUP_BATCH): Promise<{
  processed: number;
  deleted: number;
  skipped: number;
  failed: number;
  recovered: number;
}> {
  const now = new Date();
  let processed = 0;
  let deleted = 0;
  let skipped = 0;
  let failed = 0;

  // Step 1: Recover any stale tasks from crashed workers before claiming new ones
  const { recovered } = await recoverStaleCleanupTasks();

  // Step 2: Claim a batch of PENDING tasks
  const tasks = await prisma.storageCleanupTask.findMany({
    where: { status: 'PENDING', attempts: { lt: CLEANUP_MAX_ATTEMPTS } },
    orderBy: { createdAt: 'asc' },
    take: maxItems,
  });

  for (const task of tasks) {
    // Atomic claim: only one worker can change status from PENDING to IN_PROGRESS.
    // We also set claimedAt here — this is the lease start timestamp.
    const claimed = await prisma.storageCleanupTask.updateMany({
      where: { id: task.id, status: 'PENDING' },
      data: {
        status: 'IN_PROGRESS',
        claimedAt: now,
        lastAttemptAt: now,
        attempts: { increment: 1 },
      },
    });
    if (claimed.count === 0) continue; // Another worker claimed it first
    processed++;

    // currentAttempts = pre-claim snapshot + 1 (matches the DB after increment)
    const currentAttempts = task.attempts + 1;

    try {
      // Safety check: ensure no active DB record still references this file
      const isReferenced = await isGridFSFileReferenced(task.storageFileId);
      if (isReferenced) {
        logger.warn(`[CleanupQueue] Skipping deletion of ${task.storageFileId} — still referenced in DB`);
        // Deferral, not failure — restore to PENDING and undo the attempt increment
        // so the retry budget is not consumed while waiting for a reference to drop.
        // Use WHERE status='IN_PROGRESS' to guard against concurrent reclaim.
        await prisma.storageCleanupTask.updateMany({
          where: { id: task.id, status: 'IN_PROGRESS' },
          data: {
            status: 'PENDING',
            attempts: { decrement: 1 },
            claimedAt: null,
            errorMessage: 'File still referenced — deferred',
          },
        });
        skipped++;
        continue;
      }

      // ── Bucket-specific deletion ───────────────────────────────────────
      // Use task.bucketName, not the global default storage provider.
      // This ensures documents uploaded to non-default buckets are deleted correctly.
      const bucketName = validateBucketName(task.bucketName);
      const { getGridFSBucket } = await import('./mongodb-client');
      const { ObjectId } = await import('mongodb');
      const bucket = await getGridFSBucket(bucketName);

      await bucket.delete(new ObjectId(task.storageFileId));

      // Mark complete — guard against stale worker completing a recovered task
      const completed = await prisma.storageCleanupTask.updateMany({
        where: { id: task.id, status: 'IN_PROGRESS' },
        data: { status: 'COMPLETED', completedAt: now, claimedAt: null },
      });

      if (completed.count > 0) {
        deleted++;
        logger.info(`[CleanupQueue] Deleted GridFS object ${task.storageFileId}`, {
          reason: task.reason,
          bucket: bucketName,
        });
      } else {
        // Task was reclaimed by recovery — the delete still happened; just log
        logger.warn(`[CleanupQueue] Deletion succeeded but task was already reclaimed`, {
          taskId: task.id,
          storageFileId: task.storageFileId,
        });
        deleted++;
      }
    } catch (err: any) {
      const safeMessage = sanitiseError(err);
      const isFinal = currentAttempts >= CLEANUP_MAX_ATTEMPTS;

      // Handle idempotent case: object already gone
      if (isFileNotFound(err)) {
        // Treat missing object as successfully deleted — the cleanup goal is achieved
        await prisma.storageCleanupTask.updateMany({
          where: { id: task.id, status: 'IN_PROGRESS' },
          data: { status: 'COMPLETED', completedAt: now, claimedAt: null },
        });
        deleted++;
        logger.info(`[CleanupQueue] GridFS object already absent — marked complete (idempotent)`, {
          storageFileId: task.storageFileId,
        });
        continue;
      }

      // Genuine failure — increment retry or mark final
      await prisma.storageCleanupTask.updateMany({
        where: { id: task.id, status: 'IN_PROGRESS' },
        data: {
          status: isFinal ? 'FAILED' : 'PENDING',
          errorMessage: safeMessage,
          claimedAt: null,
        },
      });

      if (isFinal) {
        logger.error(
          `[CleanupQueue] FAILED to delete GridFS object ${task.storageFileId} after ${currentAttempts} attempts`,
          { reason: task.reason, bucket: task.bucketName, error: safeMessage }
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

  return { processed, deleted, skipped, failed, recovered };
}

// ─── Reference verification & Coordination ────────────────────────────────

/**
 * Checks all five PostgreSQL models that can reference a GridFS object.
 * Returns true if ANY active record still references the given storageFileId.
 * Also checks legacy mongoFile.gridFSId references.
 *
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
 * Check whether a GridFS object is scheduled for deletion (IN_PROGRESS or PENDING).
 *
 * Upload code that reuses an existing storageFileId should call this before
 * writing a new DB reference. If this returns true, a new unique GridFS object
 * should be uploaded instead of reusing the existing ID.
 *
 * This closes the race between:
 *   1. Cleanup verifies no references → 2. Upload writes new reference →
 *   3. Cleanup deletes → 4. DB record points to missing object.
 *
 * FAIL-CLOSED: returns true (protected) if query throws.
 */
export async function isGridFSObjectScheduledForDeletion(storageFileId: string): Promise<boolean> {
  try {
    const task = await prisma.storageCleanupTask.findFirst({
      where: {
        storageFileId,
        status: { in: ['PENDING', 'IN_PROGRESS'] },
      },
      select: { id: true },
    });
    return task !== null;
  } catch (err) {
    logger.error('[CleanupQueue] isGridFSObjectScheduledForDeletion query failed — treating as scheduled (fail-closed)', err);
    return true;
  }
}

/**
 * Acquires an exclusive deletion lease for a GridFS object in PostgreSQL.
 *
 * This acts as a distributed tombstone:
 * - If no task exists: creates a new StorageCleanupTask with status 'IN_PROGRESS' and claimedAt = now.
 * - If a task exists with 'PENDING': atomically claims it to 'IN_PROGRESS' with claimedAt = now.
 * - If a task exists with 'IN_PROGRESS' and its lease has expired: reclaims it.
 * - If an active lease is held by another worker: returns null (locked/busy).
 * - If already 'COMPLETED': returns null (already deleted).
 *
 * Returns { leaseId } on success, or null if lease could not be acquired.
 */
export async function acquireDeletionLease(
  storageFileId: string,
  reason: string = 'orphan',
  bucketName: string = 'data_guardian_files'
): Promise<{ leaseId: string } | null> {
  const now = new Date();
  const leaseExpiry = new Date(Date.now() - CLEANUP_LEASE_TIMEOUT_MS);

  try {
    const existing = await prisma.storageCleanupTask.findFirst({
      where: { storageFileId },
      orderBy: { createdAt: 'desc' },
    });

    if (!existing) {
      const created = await prisma.storageCleanupTask.create({
        data: {
          storageFileId,
          bucketName: validateBucketName(bucketName),
          reason,
          status: 'IN_PROGRESS',
          claimedAt: now,
          lastAttemptAt: now,
          attempts: 1,
        },
      });
      return { leaseId: created.id };
    }

    if (existing.status === 'COMPLETED') {
      return null; // Already deleted
    }

    if (existing.status === 'IN_PROGRESS') {
      if (existing.claimedAt && existing.claimedAt > leaseExpiry) {
        return null; // Active lease held by another worker
      }
      // Lease expired — reclaim atomically
      const reclaimed = await prisma.storageCleanupTask.updateMany({
        where: { id: existing.id, status: 'IN_PROGRESS', claimedAt: existing.claimedAt },
        data: { claimedAt: now, lastAttemptAt: now, attempts: { increment: 1 } },
      });
      return reclaimed.count > 0 ? { leaseId: existing.id } : null;
    }

    if (existing.status === 'PENDING') {
      const claimed = await prisma.storageCleanupTask.updateMany({
        where: { id: existing.id, status: 'PENDING' },
        data: { status: 'IN_PROGRESS', claimedAt: now, lastAttemptAt: now, attempts: { increment: 1 } },
      });
      return claimed.count > 0 ? { leaseId: existing.id } : null;
    }

    return null;
  } catch (err) {
    logger.error('[CleanupQueue] acquireDeletionLease failed (fail-closed)', err);
    return null;
  }
}

/**
 * Releases a deletion lease without deleting the object (e.g. if reference check detected
 * an active reference after lease acquisition).
 */
export async function releaseDeletionLease(storageFileId: string): Promise<void> {
  try {
    await prisma.storageCleanupTask.deleteMany({
      where: { storageFileId, status: 'IN_PROGRESS' },
    });
  } catch (err) {
    logger.error('[CleanupQueue] releaseDeletionLease failed', err);
  }
}

/**
 * Marks a deletion lease COMPLETED after confirmed deletion from GridFS.
 */
export async function completeDeletionLease(storageFileId: string): Promise<void> {
  const now = new Date();
  try {
    await prisma.storageCleanupTask.updateMany({
      where: { storageFileId, status: 'IN_PROGRESS' },
      data: { status: 'COMPLETED', completedAt: now, claimedAt: null },
    });
  } catch (err) {
    logger.error('[CleanupQueue] completeDeletionLease failed', err);
  }
}

/**
 * Records a deletion failure against an in-progress deletion lease.
 */
export async function recordDeletionFailure(storageFileId: string, err: unknown): Promise<void> {
  const safeMessage = sanitiseError(err);
  try {
    await prisma.storageCleanupTask.updateMany({
      where: { storageFileId, status: 'IN_PROGRESS' },
      data: {
        status: 'FAILED',
        errorMessage: safeMessage,
        claimedAt: null,
      },
    });
  } catch (e) {
    logger.error('[CleanupQueue] recordDeletionFailure failed', e);
  }
}

/**
 * Asserts that a storage file is safe to reference.
 * Throws an error if the object is currently locked for deletion (IN_PROGRESS)
 * or has already been deleted (COMPLETED).
 *
 * If the object has a PENDING cleanup task (e.g. was scheduled for cleanup but not yet claimed),
 * and an operation legitimately wants to reference it (e.g. document restore),
 * this cancels the PENDING cleanup task so it will not be deleted!
 */
export async function assertStorageFileAvailable(
  storageFileId: string | null | undefined,
  tx?: Parameters<Parameters<typeof prisma.$transaction>[0]>[0] | typeof prisma
): Promise<void> {
  if (!storageFileId) return;
  const client = (tx || prisma) as typeof prisma;

  const task = await client.storageCleanupTask.findFirst({
    where: { storageFileId },
    orderBy: { createdAt: 'desc' },
    select: { id: true, status: true, claimedAt: true },
  });

  if (!task) return; // Completely available

  if (task.status === 'COMPLETED') {
    throw new Error(`Storage object ${storageFileId} has been deleted and cannot be referenced`);
  }

  if (task.status === 'IN_PROGRESS') {
    const now = Date.now();
    const claimedTime = task.claimedAt ? new Date(task.claimedAt).getTime() : 0;
    const isLeaseActive = (now - claimedTime) < CLEANUP_LEASE_TIMEOUT_MS;

    if (isLeaseActive) {
      throw new Error(`Storage object ${storageFileId} is currently locked for deletion`);
    }
    throw new Error(`Storage object ${storageFileId} has an expired deletion lease in progress`);
  }

  if (task.status === 'PENDING') {
    await client.storageCleanupTask.deleteMany({
      where: { storageFileId, status: 'PENDING' },
    });
    logger.info(`[CleanupQueue] Canceled PENDING cleanup task for ${storageFileId} — object re-referenced`);
  }
}

// ─── Internal helpers ──────────────────────────────────────────────────────

/**
 * Returns true if the error indicates the GridFS object is already absent.
 * MongoDB GridFS throws "FileNotFound" for missing objects.
 */
function isFileNotFound(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return msg.includes('FileNotFound');
}

/**
 * Validates and returns a safe bucket name.
 * Only allows alphanumeric, underscore, and hyphen characters.
 * Falls back to the default bucket on invalid input rather than throwing,
 * to preserve backward compatibility with tasks that may have been stored
 * with an unusual bucket name before this validation was introduced.
 */
export function validateBucketName(name: string | null | undefined): string {
  const DEFAULT = 'data_guardian_files';
  if (!name || typeof name !== 'string') return DEFAULT;
  const safe = name.trim();
  if (!/^[a-zA-Z0-9_-]{1,64}$/.test(safe)) {
    logger.warn(`[CleanupQueue] Invalid bucket name "${safe}" — falling back to default`);
    return DEFAULT;
  }
  return safe;
}

/**
 * Produce a safe, bounded error message for persistence.
 * - Strips long hex strings (possible keys/tokens).
 * - Limits to 500 characters.
 * Never logs stack traces or environment-variable values.
 */
function sanitiseError(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);
  const stripped = raw.replace(/[0-9a-f]{33,}/gi, '[REDACTED]');
  return stripped.slice(0, 500) || 'Unknown error';
}
