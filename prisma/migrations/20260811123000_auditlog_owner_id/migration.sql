-- Denormalize AuditLog.ownerId so owner queries do not join SecureLink
-- (and remain visible after link cleanup sets linkId NULL).

ALTER TABLE "AuditLog" ADD COLUMN IF NOT EXISTS "ownerId" TEXT;

UPDATE "AuditLog" AS a
SET "ownerId" = s."ownerId"
FROM "SecureLink" AS s
WHERE a."linkId" = s."id"
  AND a."ownerId" IS NULL
  AND s."ownerId" IS NOT NULL;

CREATE INDEX IF NOT EXISTS "AuditLog_ownerId_timestamp_idx" ON "AuditLog"("ownerId", "timestamp");
