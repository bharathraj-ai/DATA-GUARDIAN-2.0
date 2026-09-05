-- AlterTable
ALTER TABLE "AuditLog" ADD COLUMN IF NOT EXISTS "prevHash" TEXT;
ALTER TABLE "AuditLog" ADD COLUMN IF NOT EXISTS "entryHash" TEXT;

CREATE INDEX IF NOT EXISTS "AuditLog_entryHash_idx" ON "AuditLog"("entryHash");
