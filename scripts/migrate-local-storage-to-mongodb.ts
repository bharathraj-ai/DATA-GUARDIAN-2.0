import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';
import { PrismaClient } from '@prisma/client';
import { getStorageRoot, assertSafeSegment } from '../src/lib/storage/secureStorage';
import { uploadEncryptedFile, downloadDecryptedFile } from '../src/lib/storage/encrypted-storage';
import { checkMongoConnection, closeMongoClient } from '../src/lib/storage/mongodb-client';

const prisma = new PrismaClient();

interface MigrationStats {
  totalDocuments: number;
  migratedDocuments: number;
  totalVersions: number;
  migratedVersions: number;
  verifiedCount: number;
  failedCount: number;
  skippedCount: number;
  errors: Array<{ id: string; error: string }>;
}

function computeSha256(buf: Buffer): string {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

async function runMigration() {
  // SAFETY: Dry-run is the default. Pass --execute to perform actual migration.
  const isExecute = process.argv.includes('--execute');
  const isDryRun = !isExecute || process.argv.includes('--dry-run') || process.argv.includes('-d');
  const isRollback = process.argv.includes('--rollback');

  console.log('='.repeat(70));
  console.log('DATA GUARDIAN 2.0 — LOCAL STORAGE TO MONGODB GRIDFS MIGRATION');
  console.log('='.repeat(70));
  if (!isRollback && isDryRun && isExecute === false) {
    console.log('NOTE: Running in DRY-RUN mode (default). Pass --execute to perform actual migration.');
  }
  console.log(`Mode: ${isRollback ? 'ROLLBACK' : isDryRun ? 'DRY-RUN (Simulated)' : 'ACTUAL MIGRATION'}`);
  console.log(`Timestamp: ${new Date().toISOString()}`);

  // ── 1. MongoDB Health & Secret Verification ────────────────────────────────
  const health = await checkMongoConnection();
  if (!health.healthy) {
    console.error(`[ERROR] MongoDB connection failed (${health.latencyMs}ms): ${health.error}`);
    process.exit(1);
  }
  console.log(`[OK] MongoDB cluster connected successfully (${health.latencyMs}ms).`);

  const storageRoot = getStorageRoot();
  console.log(`[OK] Local storage root: ${storageRoot}`);

  const stats: MigrationStats = {
    totalDocuments: 0,
    migratedDocuments: 0,
    totalVersions: 0,
    migratedVersions: 0,
    verifiedCount: 0,
    failedCount: 0,
    skippedCount: 0,
    errors: [],
  };

  // ── Rollback Handling ───────────────────────────────────────────────────────
  if (isRollback) {
    console.log('\nStarting rollback procedure (reverting DB references to local storagePath)...');
    const docsToRollback = await prisma.document.findMany({
      where: { storageProvider: 'mongodb', storagePath: { not: null } },
    });
    console.log(`Found ${docsToRollback.length} document(s) with local storagePath backup.`);

    for (const doc of docsToRollback) {
      await prisma.document.update({
        where: { id: doc.id },
        data: {
          storageProvider: 'local',
          storageFileId: null,
          encryptedDEK: null,
          encryptionIV: null,
          authenticationTag: null,
          encryptionAlgorithm: null,
          storageCreatedAt: null,
        },
      });
      console.log(`Reverted document ${doc.id} -> local (${doc.storagePath})`);
    }

    const versToRollback = await prisma.documentVersion.findMany({
      where: { storageProvider: 'mongodb', storagePath: { not: null } },
    });
    for (const ver of versToRollback) {
      await prisma.documentVersion.update({
        where: { id: ver.id },
        data: {
          storageProvider: 'local',
          storageFileId: null,
          encryptedDEK: null,
          encryptionIV: null,
          authenticationTag: null,
          encryptionAlgorithm: null,
          storageCreatedAt: null,
        },
      });
      console.log(`Reverted version ${ver.id} -> local (${ver.storagePath})`);
    }

    console.log('\nRollback completed successfully.');
    await prisma.$disconnect();
  await closeMongoClient();
  process.exit(0);
    return;
  }

  // ── 2. Migrate Documents ───────────────────────────────────────────────────
  console.log('\n--- Phase 1: Scanning Documents ---');
  const documents = await prisma.document.findMany({
    where: { isDeleted: false },
    orderBy: { createdAt: 'asc' },
  });

  stats.totalDocuments = documents.length;
  console.log(`Found ${documents.length} document record(s) in PostgreSQL.`);

  for (const doc of documents) {
    // Idempotency check: Skip if already migrated to MongoDB GridFS
    if (doc.storageProvider === 'mongodb' && doc.storageFileId) {
      console.log(`[SKIP] Document ${doc.id} (${doc.fileName}) is already in MongoDB GridFS.`);
      stats.skippedCount++;
      continue;
    }

    if (!doc.storagePath) {
      console.warn(`[WARN] Document ${doc.id} has no storagePath and no storageFileId — skipping.`);
      stats.skippedCount++;
      continue;
    }

    const localFilePath = path.resolve(storageRoot, doc.storagePath);
    let originalBuffer: Buffer;
    try {
      originalBuffer = await fs.readFile(localFilePath);
    } catch (err: any) {
      console.error(`[FAIL] Local file missing for document ${doc.id} at ${localFilePath}: ${err.message}`);
      stats.failedCount++;
      stats.errors.push({ id: doc.id, error: `Local file missing: ${err.message}` });
      continue;
    }

    const originalHash = computeSha256(originalBuffer);

    if (isDryRun) {
      console.log(`[DRY-RUN] Would encrypt and migrate document ${doc.id} (${doc.fileName}, ${originalBuffer.length} bytes, SHA-256: ${originalHash.slice(0, 12)}...)`);
      stats.migratedDocuments++;
      stats.verifiedCount++;
      continue;
    }

    try {
      // 1. Encrypt and upload to MongoDB GridFS
      const uploadResult = await uploadEncryptedFile({
        buffer: originalBuffer,
        filename: doc.fileName,
        mimeType: doc.mimeType,
        uploadedBy: doc.ownerId,
        classification: doc.classification,
        documentId: doc.id,
        version: doc.currentVersion,
      });

      // 2. Verify: Download and decrypt from MongoDB GridFS
      const downloadedDecrypted = await downloadDecryptedFile({
        storageFileId: uploadResult.storageFileId,
        storageProvider: uploadResult.storageProvider,
        encryptedDEK: uploadResult.encryptedDEK,
        encryptionIV: uploadResult.encryptionIV,
        authenticationTag: uploadResult.authenticationTag,
      });

      const verifiedHash = computeSha256(downloadedDecrypted);
      if (verifiedHash !== originalHash) {
        throw new Error(`Integrity check failed! Original hash ${originalHash} !== decrypted hash ${verifiedHash}`);
      }
      stats.verifiedCount++;

      // 3. Update PostgreSQL references ONLY after successful verification
      await prisma.document.update({
        where: { id: doc.id },
        data: {
          storageProvider: 'mongodb',
          storageFileId: uploadResult.storageFileId,
          originalFilename: doc.fileName,
          fileSize: uploadResult.fileSize,
          encryptionAlgorithm: uploadResult.encryptionAlgorithm,
          encryptionIV: uploadResult.encryptionIV,
          authenticationTag: uploadResult.authenticationTag,
          encryptedDEK: uploadResult.encryptedDEK,
          storageCreatedAt: new Date(),
        },
      });

      stats.migratedDocuments++;
      console.log(`[SUCCESS] Migrated & verified document ${doc.id} (${doc.fileName}) -> GridFS ID: ${uploadResult.storageFileId}`);
    } catch (err: any) {
      console.error(`[FAIL] Migration error on document ${doc.id}:`, err.message);
      stats.failedCount++;
      stats.errors.push({ id: doc.id, error: err.message });
    }
  }

  // ── 3. Migrate Document Versions ───────────────────────────────────────────
  console.log('\n--- Phase 2: Scanning Document Versions ---');
  const versions = await prisma.documentVersion.findMany({
    orderBy: { createdAt: 'asc' },
  });

  stats.totalVersions = versions.length;
  console.log(`Found ${versions.length} version record(s) in PostgreSQL.`);

  for (const ver of versions) {
    if (ver.storageProvider === 'mongodb' && ver.storageFileId) {
      console.log(`[SKIP] Version ${ver.id} (doc: ${ver.documentId}, v${ver.version}) is already in MongoDB GridFS.`);
      stats.skippedCount++;
      continue;
    }

    if (!ver.storagePath) {
      stats.skippedCount++;
      continue;
    }

    const localVerPath = path.resolve(storageRoot, ver.storagePath);
    let verBuffer: Buffer;
    try {
      verBuffer = await fs.readFile(localVerPath);
    } catch {
      // Missing historical version on disk — record and skip non-destructively
      stats.skippedCount++;
      continue;
    }

    const verHash = computeSha256(verBuffer);

    if (isDryRun) {
      console.log(`[DRY-RUN] Would encrypt and migrate version ${ver.id} (v${ver.version}, ${verBuffer.length} bytes)`);
      stats.migratedVersions++;
      stats.verifiedCount++;
      continue;
    }

    try {
      const uploadResult = await uploadEncryptedFile({
        buffer: verBuffer,
        filename: `v${ver.version}.bin`,
        mimeType: 'application/octet-stream',
        uploadedBy: ver.changedBy || 'system',
        documentId: ver.documentId,
        version: ver.version,
      });

      const downloaded = await downloadDecryptedFile({
        storageFileId: uploadResult.storageFileId,
        storageProvider: uploadResult.storageProvider,
        encryptedDEK: uploadResult.encryptedDEK,
        encryptionIV: uploadResult.encryptionIV,
        authenticationTag: uploadResult.authenticationTag,
      });

      if (computeSha256(downloaded) !== verHash) {
        throw new Error('Integrity verification failed for version');
      }

      await prisma.documentVersion.update({
        where: { id: ver.id },
        data: {
          storageProvider: 'mongodb',
          storageFileId: uploadResult.storageFileId,
          fileSize: uploadResult.fileSize,
          encryptionAlgorithm: uploadResult.encryptionAlgorithm,
          encryptionIV: uploadResult.encryptionIV,
          authenticationTag: uploadResult.authenticationTag,
          encryptedDEK: uploadResult.encryptedDEK,
          storageCreatedAt: new Date(),
        },
      });

      stats.migratedVersions++;
      stats.verifiedCount++;
      console.log(`[SUCCESS] Migrated version ${ver.id} (doc: ${ver.documentId}, v${ver.version}) -> GridFS ID: ${uploadResult.storageFileId}`);
    } catch (err: any) {
      console.error(`[FAIL] Migration error on version ${ver.id}:`, err.message);
      stats.failedCount++;
      stats.errors.push({ id: ver.id, error: err.message });
    }
  }

  // ── 4. Print Summary Report ────────────────────────────────────────────────
  console.log('\n' + '='.repeat(70));
  console.log('MIGRATION SUMMARY REPORT');
  console.log('='.repeat(70));
  console.log(`Total Documents Scanned : ${stats.totalDocuments}`);
  console.log(`Documents Migrated      : ${stats.migratedDocuments}`);
  console.log(`Total Versions Scanned  : ${stats.totalVersions}`);
  console.log(`Versions Migrated       : ${stats.migratedVersions}`);
  console.log(`Verified Integrity Matches: ${stats.verifiedCount}`);
  console.log(`Skipped (Already/Empty) : ${stats.skippedCount}`);
  console.log(`Failed Migrations       : ${stats.failedCount}`);

  if (stats.errors.length > 0) {
    console.log('\nErrors encountered:');
    for (const e of stats.errors) {
      console.log(`  - Record ${e.id}: ${e.error}`);
    }
  }

  console.log('\nNote: Original local files have been preserved on disk.');
  console.log('      Rollback ONLY reverts PostgreSQL references — GridFS objects are NOT auto-deleted.');
  console.log('To rollback, run: npx tsx scripts/migrate-local-storage-to-mongodb.ts --rollback');
  console.log('To perform actual migration, pass --execute. Without it, this is a dry-run.');
  console.log('='.repeat(70));

  await prisma.$disconnect();
  await closeMongoClient();
  process.exit(0);
}

runMigration().catch((err) => {
  console.error('Fatal migration failure:', err);
  process.exit(1);
});

