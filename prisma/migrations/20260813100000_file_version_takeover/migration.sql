-- Audit fields for priority-takeover snapshots (reuses FileVersion; no parallel versioning table).

ALTER TABLE "FileVersion" ADD COLUMN IF NOT EXISTS "createdBy" TEXT;
ALTER TABLE "FileVersion" ADD COLUMN IF NOT EXISTS "reason" TEXT;
ALTER TABLE "FileVersion" ADD COLUMN IF NOT EXISTS "previousVersionId" TEXT;

CREATE INDEX IF NOT EXISTS "FileVersion_createdBy_idx" ON "FileVersion"("createdBy");
CREATE INDEX IF NOT EXISTS "FileVersion_reason_idx" ON "FileVersion"("reason");
CREATE INDEX IF NOT EXISTS "UserFile_lockedBy_idx" ON "UserFile"("lockedBy");
