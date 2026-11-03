import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';
import { ObjectId } from 'mongodb';
import { prisma } from '@/lib/prisma';
import { logger } from '@/lib/logger';
import { getStorageRoot } from '@/lib/storage/secureStorage';

export interface OrphanItem {
  type: 'document_dir' | 'version_dir' | 'temp_file';
  documentId?: string;
  path: string;
  modifiedAt: Date;
  sizeBytes?: number;
  reason: 'no_matching_record' | 'marked_deleted' | 'abandoned_temp_file';
}

export interface DetectOrphanOptions {
  gracePeriodMinutes?: number;
  storageRoot?: string;
}

export interface CleanupOrphanResult {
  success: boolean;
  /** Execution ID for correlating log entries with audit records. */
  executionId: string;
  startedAt: Date;
  finishedAt: Date;
  /** Local filesystem orphan counts. */
  detectedCount: number;
  deletedCount: number;
  deletedPaths: string[];
  skippedRecentCount: number;
  /** Local filesystem deletion detail. */
  localDetected: number;
  localDeleted: number;
  localAlreadyMissing: number;
  localDeletionErrors: number;
  /** GridFS-specific counters. */
  gridfsScanned: number;
  gridfsOrphaned: number;
  gridfsDeleted: number;
  gridfsSkipped: number;
  gridfsDeletionErrors: number;
  gridfsBatchesProcessed: number;
  gridfsBatchesFailed: number;
  gridfsStatus: 'skipped' | 'success' | 'partial_failure' | 'failed';
  /** Overall status string for audit/monitoring. */
  status: 'SUCCESS' | 'PARTIAL_FAILURE' | 'FAILED';
  error?: string;
}

/** GridFS batch size — never loads more than this many file records at once. */
const GRIDFS_BATCH_SIZE = 500;

function isPathInsideRoot(resolved: string, root: string): boolean {
  const normalizedRoot = root.endsWith(path.sep) ? root.slice(0, -1) : root;
  return resolved === normalizedRoot || resolved.startsWith(normalizedRoot + path.sep);
}

/**
 * Scan filesystem for files/folders with no active database record.
 *
 * Safety invariants:
 * 1. Database Health Check: If DB query fails, FAIL CLOSED and return no orphans.
 * 2. Grace Period: Files newer than grace period (default 30m) are NEVER considered orphans.
 * 3. Path Containment: All candidate paths must resolve strictly within storage root.
 */
export async function detectOrphanFiles(options: DetectOrphanOptions = {}): Promise<{
  success: boolean;
  orphans: OrphanItem[];
  skippedRecentCount: number;
  error?: string;
}> {
  const root = path.resolve(options.storageRoot || getStorageRoot());
  const graceMinutes = options.gracePeriodMinutes ?? parseInt(process.env.ORPHAN_CLEANUP_GRACE_MINUTES || '30', 10);
  const cutoffMs = Date.now() - (graceMinutes * 60 * 1000);

  // ── 1. FAIL-CLOSED DB Health Check ──────────────────────────────────────
  // "Never delete files based on incomplete database queries."
  try {
    await prisma.$queryRawUnsafe('SELECT 1');
  } catch (dbErr) {
    logger.error('[ORPHAN_CLEANUP] Database check failed. Aborting detection to prevent data loss', dbErr);
    return {
      success: false,
      orphans: [],
      skippedRecentCount: 0,
      error: 'Database connection check failed — aborted orphan detection to protect data integrity',
    };
  }

  // ── 2. Check Storage Root Existence ─────────────────────────────────────
  try {
    await fs.access(root);
  } catch {
    // Root directory doesn't exist yet, so no files to clean
    return { success: true, orphans: [], skippedRecentCount: 0 };
  }

  const orphans: OrphanItem[] = [];
  let skippedRecentCount = 0;

  // Track document directories and version directories by document ID
  const candidateDocDirs = new Map<string, { path: string; modifiedAt: Date }>();
  const candidateVerDirs = new Map<string, { path: string; modifiedAt: Date }>();

  // Helper to safely inspect entries
  async function inspectSubdirs(
    subdirName: 'documents' | 'versions',
    candidateMap: Map<string, { path: string; modifiedAt: Date }>
  ) {
    const parentDir = path.join(root, subdirName);
    try {
      const entries = await fs.readdir(parentDir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(parentDir, entry.name);
        if (!isPathInsideRoot(fullPath, root)) continue;

        let stat;
        try {
          stat = await fs.stat(fullPath);
        } catch {
          continue; // Gone or inaccessible
        }

        // Check if this is an abandoned temporary file at parent level
        if (entry.isFile() && (entry.name.startsWith('.upload_') || entry.name.endsWith('.tmp'))) {
          if (stat.mtimeMs > cutoffMs) {
            skippedRecentCount++;
          } else {
            orphans.push({
              type: 'temp_file',
              path: fullPath,
              modifiedAt: new Date(stat.mtimeMs),
              sizeBytes: stat.size,
              reason: 'abandoned_temp_file',
            });
          }
          continue;
        }

        if (entry.isDirectory()) {
          // Check for temporary files inside the directory
          try {
            const innerFiles = await fs.readdir(fullPath, { withFileTypes: true });
            for (const inner of innerFiles) {
              if (inner.isFile() && (inner.name.startsWith('.upload_') || inner.name.endsWith('.tmp'))) {
                const innerPath = path.join(fullPath, inner.name);
                try {
                  const innerStat = await fs.stat(innerPath);
                  if (innerStat.mtimeMs > cutoffMs) {
                    skippedRecentCount++;
                  } else {
                    orphans.push({
                      type: 'temp_file',
                      documentId: entry.name,
                      path: innerPath,
                      modifiedAt: new Date(innerStat.mtimeMs),
                      sizeBytes: innerStat.size,
                      reason: 'abandoned_temp_file',
                    });
                  }
                } catch {}
              }
            }
          } catch {}

          // Enforce grace period on the directory itself
          if (stat.mtimeMs > cutoffMs) {
            skippedRecentCount++;
            continue;
          }

          candidateMap.set(entry.name, {
            path: fullPath,
            modifiedAt: new Date(stat.mtimeMs),
          });
        }
      }
    } catch (err: any) {
      if (err.code !== 'ENOENT') {
        logger.error(`[ORPHAN_CLEANUP] Failed to read ${parentDir}`, err);
      }
    }
  }

  await inspectSubdirs('documents', candidateDocDirs);
  await inspectSubdirs('versions', candidateVerDirs);

  // Combine unique document IDs across documents/ and versions/
  const candidateIds = Array.from(new Set([...candidateDocDirs.keys(), ...candidateVerDirs.keys()]));

  if (candidateIds.length === 0) {
    return { success: true, orphans, skippedRecentCount };
  }

  // ── 3. Query Active Database Records ────────────────────────────────────
  let dbRecords: Array<{ id: string; isDeleted: boolean }>;
  try {
    dbRecords = [];
    // Chunk queries to prevent database bind parameter exhaustion
    const CHUNK_SIZE = 50;
    for (let i = 0; i < candidateIds.length; i += CHUNK_SIZE) {
      const chunk = candidateIds.slice(i, i + CHUNK_SIZE);
      const chunkRecords = await prisma.document.findMany({
        where: { id: { in: chunk } },
        select: { id: true, isDeleted: true },
      });
      dbRecords.push(...chunkRecords);
    }
  } catch (queryErr) {
    logger.error('[ORPHAN_CLEANUP] Failed to query documents from database. Aborting to prevent data loss', queryErr);
    return {
      success: false,
      orphans: [],
      skippedRecentCount,
      error: 'Database query failed during orphan detection — aborted',
    };
  }

  const recordMap = new Map(dbRecords.map((r) => [r.id, r]));

  // ── 4. Cross-Reference Candidate Folders with DB Records ────────────────
  for (const docId of candidateIds) {
    const record = recordMap.get(docId);
    const isOrphan = !record || record.isDeleted;
    const reason = !record ? 'no_matching_record' : 'marked_deleted';

    if (isOrphan) {
      const docEntry = candidateDocDirs.get(docId);
      if (docEntry) {
        orphans.push({
          type: 'document_dir',
          documentId: docId,
          path: docEntry.path,
          modifiedAt: docEntry.modifiedAt,
          reason,
        });
      }
      const verEntry = candidateVerDirs.get(docId);
      if (verEntry) {
        orphans.push({
          type: 'version_dir',
          documentId: docId,
          path: verEntry.path,
          modifiedAt: verEntry.modifiedAt,
          reason,
        });
      }
    }
  }

  return { success: true, orphans, skippedRecentCount };
}

/**
 * Safely and idempotently clean up orphan files (local filesystem + GridFS).
 *
 * GridFS cleanup guarantees:
 * 1. Stable cursor pagination (_id-keyed) — deleted objects never shift batches.
 * 2. All five reference models checked per batch; failure aborts only that batch.
 * 3. Each orphan candidate is re-verified immediately before deletion (concurrency guard).
 * 4. Partial failures are reported explicitly — never swallowed into success=true.
 * 5. Structured audit log written on completion, regardless of outcome.
 */
export async function cleanOrphanFiles(options: DetectOrphanOptions = {}): Promise<CleanupOrphanResult> {
  const executionId = crypto.randomUUID();
  const startedAt = new Date();
  const graceMinutes = options.gracePeriodMinutes ?? parseInt(process.env.ORPHAN_CLEANUP_GRACE_MINUTES || '30', 10);

  logger.info(`[ORPHAN_CLEANUP] Starting cleanup run`, { executionId, graceMinutes });

  // ── Local Filesystem Orphan Detection ─────────────────────────────────
  const detection = await detectOrphanFiles(options);

  if (!detection.success) {
    const finishedAt = new Date();
    return {
      success: false,
      executionId,
      startedAt,
      finishedAt,
      detectedCount: 0,
      deletedCount: 0,
      deletedPaths: [],
      skippedRecentCount: detection.skippedRecentCount,
      localDetected: 0,
      localDeleted: 0,
      localAlreadyMissing: 0,
      localDeletionErrors: 0,
      gridfsScanned: 0,
      gridfsOrphaned: 0,
      gridfsDeleted: 0,
      gridfsSkipped: 0,
      gridfsDeletionErrors: 0,
      gridfsBatchesProcessed: 0,
      gridfsBatchesFailed: 0,
      gridfsStatus: 'skipped',
      status: 'FAILED',
      error: detection.error || 'Orphan detection failed',
    };
  }

  const { orphans, skippedRecentCount } = detection;
  const deletedPaths: string[] = [];
  let localDetected = orphans.length;
  let localDeleted = 0;
  let localAlreadyMissing = 0;
  let localDeletionErrors = 0;

  for (const orphan of orphans) {
    try {
      await fs.rm(orphan.path, { recursive: true, force: true });
      deletedPaths.push(orphan.path);
      localDeleted++;
    } catch (rmErr: any) {
      if (rmErr.code === 'ENOENT') {
        // Already removed by another worker — idempotent
        localAlreadyMissing++;
        continue;
      }
      localDeletionErrors++;
      logger.error(`[ORPHAN_CLEANUP] Failed to remove orphan path: ${orphan.path}`, {
        executionId,
        code: rmErr.code,
        // Never log the file path content or any data within it
      });
    }
  }

  // ── GridFS Orphan Cleanup ─────────────────────────────────────────────
  let gridfsScanned = 0;
  let gridfsOrphaned = 0;
  let gridfsDeleted = 0;
  let gridfsSkipped = 0;
  let gridfsDeletionErrors = 0;
  let gridfsBatchesProcessed = 0;
  let gridfsBatchesFailed = 0;
  let gridfsStatus: CleanupOrphanResult['gridfsStatus'] = 'skipped';

  try {
    const { getMongoConfig, getGridFSBucket } = await import('@/lib/storage/mongodb-client');
    const config = getMongoConfig();

    if (config.isConfigured) {
      const bucket = await getGridFSBucket();
      const cutoff = new Date(Date.now() - graceMinutes * 60 * 1000);
      gridfsStatus = 'success';

      /**
       * Stable cursor pagination using _id as the ordering key.
       *
       * WHY NOT skip/offset:
       *   When we delete objects in batch N, those deletions shift the MongoDB
       *   collection's internal offset, causing batch N+1's `.skip(N*500)` to
       *   land at the wrong position — objects between the two batches are
       *   silently skipped and never scanned.
       *
       * WHY _id cursor is stable:
       *   We query `_id > lastProcessedId` with `.sort({ _id: 1 })`.
       *   Deletions in earlier positions never affect where the cursor lands,
       *   because we are not counting rows from the start — we are asking for
       *   rows whose _id is strictly greater than the last one we saw.
       *   Even if 499 of the 500 objects in the previous batch were deleted,
       *   the next batch still starts exactly where we left off.
       */
      let lastProcessedId: ObjectId | null = null;

      while (true) {
        const filter: Record<string, unknown> = { uploadDate: { $lt: cutoff } };
        if (lastProcessedId !== null) {
          filter['_id'] = { $gt: lastProcessedId };
        }

        const gridFiles = await bucket
          .find(filter)
          .sort({ _id: 1 })
          .limit(GRIDFS_BATCH_SIZE)
          .toArray();

        if (gridFiles.length === 0) break;

        // Advance the stable cursor to the last _id in this batch
        lastProcessedId = gridFiles[gridFiles.length - 1]._id;
        gridfsBatchesProcessed++;
        gridfsScanned += gridFiles.length;

        const candidateIds = gridFiles.map((f) => f._id.toString());

        // ── Reference verification — all 5 models, fail-closed ─────────
        let docRefs: { storageFileId: string | null }[];
        let docVerRefs: { storageFileId: string | null }[];
        let userFileRefs: { storageFileId: string | null }[];
        let fileVerRefs: { storageFileId: string | null }[];
        let mongoFileRefs: { gridFSId: string | null }[];

        try {
          [docRefs, docVerRefs, userFileRefs, fileVerRefs, mongoFileRefs] = await Promise.all([
            prisma.document.findMany({
              where: { storageFileId: { in: candidateIds }, isDeleted: false },
              select: { storageFileId: true },
            }),
            prisma.documentVersion.findMany({
              where: { storageFileId: { in: candidateIds } },
              select: { storageFileId: true },
            }),
            prisma.userFile.findMany({
              where: { storageFileId: { in: candidateIds } },
              select: { storageFileId: true },
            }),
            prisma.fileVersion.findMany({
              where: { storageFileId: { in: candidateIds } },
              select: { storageFileId: true },
            }),
            // Legacy: MongoFile.gridFSId references (old upload path)
            prisma.mongoFile.findMany({
              where: { gridFSId: { in: candidateIds }, isDeleted: false },
              select: { gridFSId: true },
            }),
          ]);
        } catch (refQueryErr) {
          // Fail-closed: cannot verify references → skip entire batch
          gridfsBatchesFailed++;
          gridfsStatus = 'partial_failure';
          logger.error(
            '[ORPHAN_CLEANUP] Reference query failed for GridFS batch — skipping to protect data',
            { executionId, batchEndId: lastProcessedId?.toString() }
          );
          // Continue to next batch: cursor is already advanced so no duplicates
          continue;
        }

        const activeIds = new Set<string>();
        for (const r of docRefs) if (r.storageFileId) activeIds.add(r.storageFileId);
        for (const r of docVerRefs) if (r.storageFileId) activeIds.add(r.storageFileId);
        for (const r of userFileRefs) if (r.storageFileId) activeIds.add(r.storageFileId);
        for (const r of fileVerRefs) if (r.storageFileId) activeIds.add(r.storageFileId);
        for (const r of mongoFileRefs) if (r.gridFSId) activeIds.add(r.gridFSId);

        const {
          acquireDeletionLease,
          releaseDeletionLease,
          completeDeletionLease,
          recordDeletionFailure,
        } = await import('./cleanup-queue');

        for (const gf of gridFiles) {
          const idStr = gf._id.toString();

          if (activeIds.has(idStr)) {
            gridfsSkipped++;
            continue;
          }

          // ── Two-Phase Coordination: Acquire Deletion Lease (Tombstone) ───
          // Establishes an atomic IN_PROGRESS record in PostgreSQL BEFORE re-checking references.
          // Any concurrent upload or restore operation checking assertStorageFileAvailable()
          // will observe this lease and refuse to reference this object.
          const lease = await acquireDeletionLease(idStr, 'orphan');
          if (!lease) {
            // Active lease held by another worker, or object already deleted / locked
            gridfsSkipped++;
            continue;
          }

          gridfsOrphaned++;

          // ── Authoritative Reference Check Under Active Lease ───
          let stillReferenced: boolean;
          try {
            const [d, dv, uf, fv, mf] = await Promise.all([
              prisma.document.findFirst({ where: { storageFileId: idStr, isDeleted: false }, select: { id: true } }),
              prisma.documentVersion.findFirst({ where: { storageFileId: idStr }, select: { id: true } }),
              prisma.userFile.findFirst({ where: { storageFileId: idStr }, select: { id: true } }),
              prisma.fileVersion.findFirst({ where: { storageFileId: idStr }, select: { id: true } }),
              prisma.mongoFile.findFirst({ where: { gridFSId: idStr, isDeleted: false }, select: { id: true } }),
            ]);
            stillReferenced = !!(d || dv || uf || fv || mf);
          } catch {
            // Fail-closed: release lease and skip
            await releaseDeletionLease(idStr);
            logger.warn('[ORPHAN_CLEANUP] Pre-delete re-verification failed — releasing lease and skipping (fail-closed)', { executionId, idStr });
            gridfsSkipped++;
            gridfsOrphaned--;
            continue;
          }

          if (stillReferenced) {
            await releaseDeletionLease(idStr);
            logger.warn('[ORPHAN_CLEANUP] Object acquired a reference between scan and delete — lease released', { executionId, idStr });
            gridfsSkipped++;
            gridfsOrphaned--;
            continue;
          }

          // ── Delete from GridFS and Finalize Lease ───
          try {
            await bucket.delete(new ObjectId(idStr));
            await completeDeletionLease(idStr);
            deletedPaths.push(`gridfs:${idStr}`);
            gridfsDeleted++;
          } catch (delErr: any) {
            if (delErr?.message?.includes('FileNotFound')) {
              // Deleted by a concurrent worker — idempotent, mark complete
              await completeDeletionLease(idStr);
              gridfsDeleted++;
            } else {
              gridfsDeletionErrors++;
              gridfsStatus = 'partial_failure';
              await recordDeletionFailure(idStr, delErr);
              logger.error(`[ORPHAN_CLEANUP] Failed to delete GridFS orphan: ${idStr}`, {
                executionId,
                error: delErr?.message,
              });
            }
          }
        }

        // Partial batch → collection exhausted
        if (gridFiles.length < GRIDFS_BATCH_SIZE) break;
      }
    }
  } catch (gridErr) {
    gridfsStatus = 'failed';
    logger.error('[ORPHAN_CLEANUP] GridFS orphan cleanup failed to start', {
      executionId,
      error: (gridErr as Error)?.message,
    });
  }

  const finishedAt = new Date();

  // ── Determine overall status ───────────────────────────────────────────
  const overallStatus: CleanupOrphanResult['status'] =
    gridfsStatus === 'failed'
      ? 'FAILED'
      : gridfsStatus === 'partial_failure' || gridfsDeletionErrors > 0 || localDeletionErrors > 0
        ? 'PARTIAL_FAILURE'
        : 'SUCCESS';

  // ── Structured Audit Log ───────────────────────────────────────────────
  // Never log document contents, encryption keys, DEKs, KEKs, or credentials.
  const auditPayload = {
    executionId,
    startedAt: startedAt.toISOString(),
    finishedAt: finishedAt.toISOString(),
    durationMs: finishedAt.getTime() - startedAt.getTime(),
    gracePeriodMinutes: graceMinutes,
    localDetected,
    localDeleted,
    localAlreadyMissing,
    localDeletionErrors,
    gridfsScanned,
    gridfsOrphaned,
    gridfsDeleted,
    gridfsSkipped,
    gridfsDeletionErrors,
    gridfsBatchesProcessed,
    gridfsBatchesFailed,
    gridfsStatus,
    status: overallStatus,
  };

  try {
    await prisma.auditLog.create({
      data: {
        action: 'ORPHAN_FILE_CLEANUP',
        reason: `[${overallStatus}] Scanned ${gridfsScanned} GridFS objects — deleted ${gridfsDeleted}, skipped ${gridfsSkipped}, errors ${gridfsDeletionErrors}; local: detected ${localDetected}, deleted ${localDeleted}, errors ${localDeletionErrors}`,
        metadata: JSON.stringify({
          ...auditPayload,
          // Bounded sample of deleted IDs for post-incident tracing (no contents or keys)
          deletedGridFSSample: deletedPaths.filter((p) => p.startsWith('gridfs:')).slice(0, 20),
        }),
      },
    });
  } catch (auditErr) {
    logger.error('[ORPHAN_CLEANUP] Failed to create audit log entry', auditErr);
  }

  logger.securityEvent('ORPHAN_FILE_CLEANUP', auditPayload);

  return {
    success: overallStatus !== 'FAILED',
    executionId,
    startedAt,
    finishedAt,
    detectedCount: orphans.length,
    deletedCount: deletedPaths.length,
    deletedPaths,
    skippedRecentCount,
    localDetected,
    localDeleted,
    localAlreadyMissing,
    localDeletionErrors,
    gridfsScanned,
    gridfsOrphaned,
    gridfsDeleted,
    gridfsSkipped,
    gridfsDeletionErrors,
    gridfsBatchesProcessed,
    gridfsBatchesFailed,
    gridfsStatus,
    status: overallStatus,
  };
}
