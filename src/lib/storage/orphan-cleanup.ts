import fs from 'fs/promises';
import path from 'path';
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
  detectedCount: number;
  deletedCount: number;
  deletedPaths: string[];
  skippedRecentCount: number;
  error?: string;
}

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
 * Safely and idempotently clean up orphan files.
 *
 * Requirements met:
 * 1. Safe cleanup with configurable grace period.
 * 2. Never deletes files based on incomplete database queries.
 * 3. Idempotent — repeated executions will not fail or corrupt state.
 * 4. Records cleanup events in audit logs.
 */
export async function cleanOrphanFiles(options: DetectOrphanOptions = {}): Promise<CleanupOrphanResult> {
  const detection = await detectOrphanFiles(options);

  if (!detection.success) {
    return {
      success: false,
      detectedCount: 0,
      deletedCount: 0,
      deletedPaths: [],
      skippedRecentCount: detection.skippedRecentCount,
      error: detection.error || 'Orphan detection failed',
    };
  }

  const { orphans, skippedRecentCount } = detection;
  const deletedPaths: string[] = [];

  for (const orphan of orphans) {
    try {
      await fs.rm(orphan.path, { recursive: true, force: true });
      deletedPaths.push(orphan.path);
    } catch (rmErr: any) {
      // If already deleted by another process (idempotent / concurrent safe)
      if (rmErr.code === 'ENOENT') {
        continue;
      }
      logger.error(`[ORPHAN_CLEANUP] Failed to remove orphan path: ${orphan.path}`, rmErr);
    }
  }

  // ── 5. Clean MongoDB GridFS Orphans (Persistent Storage Hardening) ──────────
  try {
    const { getMongoConfig, getGridFSBucket } = await import('@/lib/storage/mongodb-client');
    const { ObjectId } = await import('mongodb');
    const config = getMongoConfig();

    if (config.isConfigured) {
      const bucket = await getGridFSBucket();
      const cutoff = new Date(Date.now() - (options.gracePeriodMinutes ?? 30) * 60 * 1000);

      // Cursor-based pagination: never load entire GridFS collection into memory.
      const BATCH_SIZE = 500;
      let skip = 0;

      while (true) {
        const gridFiles = await bucket
          .find({ uploadDate: { $lt: cutoff } })
          .skip(skip)
          .limit(BATCH_SIZE)
          .toArray();

        if (gridFiles.length === 0) break;
        skip += BATCH_SIZE;

        const candidateIds = gridFiles.map((f) => f._id.toString());

        // Check all 5 reference sources — fail-closed if any query throws
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
          // Fail-closed: if reference queries fail, skip this batch entirely
          logger.error('[ORPHAN_CLEANUP] Reference query failed for GridFS batch — skipping batch to protect data', refQueryErr);
          break;
        }

        const activeIds = new Set<string>();
        for (const r of docRefs) if (r.storageFileId) activeIds.add(r.storageFileId);
        for (const r of docVerRefs) if (r.storageFileId) activeIds.add(r.storageFileId);
        for (const r of userFileRefs) if (r.storageFileId) activeIds.add(r.storageFileId);
        for (const r of fileVerRefs) if (r.storageFileId) activeIds.add(r.storageFileId);
        for (const r of mongoFileRefs) if (r.gridFSId) activeIds.add(r.gridFSId);

        for (const gf of gridFiles) {
          const idStr = gf._id.toString();
          if (!activeIds.has(idStr)) {
            try {
              await bucket.delete(new ObjectId(idStr));
              deletedPaths.push(`gridfs:${idStr}`);
            } catch (delErr: any) {
              if (!delErr?.message?.includes('FileNotFound')) {
                logger.error(`[ORPHAN_CLEANUP] Failed to delete GridFS orphan: ${idStr}`, delErr);
              }
            }
          }
        }

        // If we got a full batch, there may be more; loop continues.
        // If partial batch, we are done.
        if (gridFiles.length < BATCH_SIZE) break;
      }
    }
  } catch (gridErr) {
    logger.error('[ORPHAN_CLEANUP] GridFS orphan cleanup error (non-blocking):', gridErr);
  }

  // ── Record in Audit Log ─────────────────────────────────────────────────
  if (deletedPaths.length > 0) {
    const graceMinutes = options.gracePeriodMinutes ?? parseInt(process.env.ORPHAN_CLEANUP_GRACE_MINUTES || '30', 10);
    try {
      await prisma.auditLog.create({
        data: {
          action: 'ORPHAN_FILE_CLEANUP',
          reason: `Purged ${deletedPaths.length} orphaned file(s)/directory(ies) with no matching active DB record`,
          metadata: JSON.stringify({
            deletedCount: deletedPaths.length,
            gracePeriodMinutes: graceMinutes,
            deletedPaths: deletedPaths.slice(0, 50),
          }),
        },
      });
    } catch (auditErr) {
      logger.error('[ORPHAN_CLEANUP] Failed to create audit log entry', auditErr);
    }

    logger.securityEvent('ORPHAN_FILE_CLEANUP', {
      deletedCount: deletedPaths.length,
      gracePeriodMinutes: graceMinutes,
    });
  }

  return {
    success: true,
    detectedCount: orphans.length,
    deletedCount: deletedPaths.length,
    deletedPaths,
    skippedRecentCount,
  };
}

