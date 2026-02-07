-- CreateTable
CREATE TABLE "UserData" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "encryptedData" TEXT NOT NULL,
    "dataHash" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "SecureLink" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "token" TEXT NOT NULL,
    "ownerToken" TEXT NOT NULL,
    "otpHash" TEXT NOT NULL,
    "expiresAt" DATETIME NOT NULL,
    "isUsed" BOOLEAN NOT NULL DEFAULT false,
    "isRevoked" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "failedAttempts" INTEGER NOT NULL DEFAULT 0,
    "lockedAt" DATETIME,
    "deviceHash" TEXT,
    "purpose" TEXT,
    "purposeDetail" TEXT,
    "notificationEmail" TEXT,
    "otpFirstAttemptAt" DATETIME,
    "otpVerifiedAt" DATETIME,
    "userId" TEXT NOT NULL,
    CONSTRAINT "SecureLink_userId_fkey" FOREIGN KEY ("userId") REFERENCES "UserData" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "UserFile" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "fileName" TEXT NOT NULL,
    "fileType" TEXT NOT NULL,
    "fileSize" INTEGER NOT NULL,
    "encryptedContent" BLOB NOT NULL,
    "iv" TEXT NOT NULL,
    "authTag" TEXT NOT NULL,
    "secureLinkId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "UserFile_secureLinkId_fkey" FOREIGN KEY ("secureLinkId") REFERENCES "SecureLink" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "action" TEXT NOT NULL,
    "timestamp" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reason" TEXT,
    "metadata" TEXT,
    "linkId" TEXT,
    CONSTRAINT "AuditLog_linkId_fkey" FOREIGN KEY ("linkId") REFERENCES "SecureLink" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "SecureLink_token_key" ON "SecureLink"("token");

-- CreateIndex
CREATE UNIQUE INDEX "SecureLink_ownerToken_key" ON "SecureLink"("ownerToken");

-- CreateIndex
CREATE UNIQUE INDEX "SecureLink_userId_key" ON "SecureLink"("userId");

-- CreateIndex
CREATE INDEX "SecureLink_token_idx" ON "SecureLink"("token");

-- CreateIndex
CREATE INDEX "SecureLink_ownerToken_idx" ON "SecureLink"("ownerToken");

-- CreateIndex
CREATE INDEX "SecureLink_expiresAt_idx" ON "SecureLink"("expiresAt");

-- CreateIndex
CREATE INDEX "UserFile_secureLinkId_idx" ON "UserFile"("secureLinkId");

-- CreateIndex
CREATE INDEX "AuditLog_linkId_idx" ON "AuditLog"("linkId");

-- CreateIndex
CREATE INDEX "AuditLog_timestamp_idx" ON "AuditLog"("timestamp");

-- CreateIndex
CREATE INDEX "AuditLog_action_idx" ON "AuditLog"("action");
