-- Additive indexes for dashboard live-link lookups, cleanup, and vendor inbox.
-- No column drops or data rewrites.

CREATE INDEX IF NOT EXISTS "SecureLink_ownerId_isRevoked_expiresAt_idx"
  ON "SecureLink"("ownerId", "isRevoked", "expiresAt");

CREATE INDEX IF NOT EXISTS "SecureLink_isRevoked_idx"
  ON "SecureLink"("isRevoked");

CREATE INDEX IF NOT EXISTS "VendorAccess_email_status_idx"
  ON "VendorAccess"("email", "status");

CREATE INDEX IF NOT EXISTS "SendRecord_ownerId_status_topic_idx"
  ON "SendRecord"("ownerId", "status", "topic");
