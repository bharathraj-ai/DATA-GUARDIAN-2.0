-- Phase 3: FileVersion ciphertext leaves Postgres BYTEA; durable job queue.

ALTER TABLE "FileVersion" ALTER COLUMN "encryptedContent" DROP NOT NULL;
ALTER TABLE "FileVersion" ADD COLUMN IF NOT EXISTS "storageKey" TEXT;

CREATE INDEX IF NOT EXISTS "FileVersion_storageKey_idx" ON "FileVersion"("storageKey");

CREATE TABLE IF NOT EXISTS "Job" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 5,
    "runAfter" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Job_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "Job_status_runAfter_idx" ON "Job"("status", "runAfter");
CREATE INDEX IF NOT EXISTS "Job_type_status_idx" ON "Job"("type", "status");
