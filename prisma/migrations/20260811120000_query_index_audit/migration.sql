-- Query/index audit: additive composites for hot paths.
-- Also drop redundant non-unique indexes that duplicate @unique keys.

-- Redundant: unique indexes already exist on token / ownerToken
DROP INDEX IF EXISTS "SecureLink_token_idx";
DROP INDEX IF EXISTS "SecureLink_ownerToken_idx";

-- Auth adapter / FK cascades
CREATE INDEX IF NOT EXISTS "Account_userId_idx" ON "Account"("userId");
CREATE INDEX IF NOT EXISTS "Session_userId_idx" ON "Session"("userId");
CREATE INDEX IF NOT EXISTS "User_role_idx" ON "User"("role");

-- Access links
CREATE INDEX IF NOT EXISTS "SecureLink_ownerId_createdAt_idx" ON "SecureLink"("ownerId", "createdAt");
CREATE INDEX IF NOT EXISTS "SecureLink_allowedVendorEmail_idx" ON "SecureLink"("allowedVendorEmail");
CREATE INDEX IF NOT EXISTS "VendorAccess_activeSessionId_idx" ON "VendorAccess"("activeSessionId");
CREATE INDEX IF NOT EXISTS "OtpHistory_vendorAccessId_status_idx" ON "OtpHistory"("vendorAccessId", "status");

-- SSE / limits / chat / presence
CREATE INDEX IF NOT EXISTS "AuditLog_linkId_action_timestamp_idx" ON "AuditLog"("linkId", "action", "timestamp");
CREATE INDEX IF NOT EXISTS "DocumentSession_token_lastSeenAt_idx" ON "DocumentSession"("token", "lastSeenAt");
CREATE INDEX IF NOT EXISTS "ChatMessage_secureLinkId_timestamp_idx" ON "ChatMessage"("secureLinkId", "timestamp");

-- Dashboard / editor
CREATE INDEX IF NOT EXISTS "SendRecord_ownerId_createdAt_idx" ON "SendRecord"("ownerId", "createdAt");
CREATE INDEX IF NOT EXISTS "SendRecord_ownerId_status_idx" ON "SendRecord"("ownerId", "status");
CREATE INDEX IF NOT EXISTS "Annotation_fileId_createdAt_idx" ON "Annotation"("fileId", "createdAt");
CREATE INDEX IF NOT EXISTS "CollabOperation_fileId_createdAt_idx" ON "CollabOperation"("fileId", "createdAt");
CREATE INDEX IF NOT EXISTS "DocumentChatMessage_fileId_createdAt_idx" ON "DocumentChatMessage"("fileId", "createdAt");
CREATE INDEX IF NOT EXISTS "Document_ownerId_isDeleted_createdAt_idx" ON "Document"("ownerId", "isDeleted", "createdAt");
CREATE INDEX IF NOT EXISTS "DocumentAuditLog_documentId_createdAt_idx" ON "DocumentAuditLog"("documentId", "createdAt");
