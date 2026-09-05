-- Phase 4: drop OnlyOffice plaintext-disk tables; add tenant + page analytics.

DROP TABLE IF EXISTS "DocumentAuditLog";
DROP TABLE IF EXISTS "DocumentVersion";
DROP TABLE IF EXISTS "DocumentGrant";
DROP TABLE IF EXISTS "Document";

CREATE TABLE IF NOT EXISTS "Organization" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "allowedDomain" TEXT,
    "kmsKeyId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Organization_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "Organization_slug_key" ON "Organization"("slug");
CREATE INDEX IF NOT EXISTS "Organization_allowedDomain_idx" ON "Organization"("allowedDomain");

CREATE TABLE IF NOT EXISTS "OrganizationMember" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'MEMBER',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OrganizationMember_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "OrganizationMember_organizationId_userId_key" ON "OrganizationMember"("organizationId", "userId");
CREATE INDEX IF NOT EXISTS "OrganizationMember_userId_idx" ON "OrganizationMember"("userId");

ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "organizationId" TEXT;
CREATE INDEX IF NOT EXISTS "User_organizationId_idx" ON "User"("organizationId");

ALTER TABLE "SecureLink" ADD COLUMN IF NOT EXISTS "organizationId" TEXT;
CREATE INDEX IF NOT EXISTS "SecureLink_organizationId_idx" ON "SecureLink"("organizationId");

CREATE TABLE IF NOT EXISTS "FileViewEvent" (
    "id" TEXT NOT NULL,
    "linkId" TEXT NOT NULL,
    "fileId" TEXT NOT NULL,
    "viewerEmail" TEXT,
    "pageNumber" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FileViewEvent_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "FileViewEvent_linkId_createdAt_idx" ON "FileViewEvent"("linkId", "createdAt");
CREATE INDEX IF NOT EXISTS "FileViewEvent_fileId_createdAt_idx" ON "FileViewEvent"("fileId", "createdAt");
CREATE INDEX IF NOT EXISTS "FileViewEvent_linkId_fileId_idx" ON "FileViewEvent"("linkId", "fileId");

ALTER TABLE "OrganizationMember" ADD CONSTRAINT "OrganizationMember_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "OrganizationMember" ADD CONSTRAINT "OrganizationMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "User" ADD CONSTRAINT "User_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "SecureLink" ADD CONSTRAINT "SecureLink_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "FileViewEvent" ADD CONSTRAINT "FileViewEvent_linkId_fkey" FOREIGN KEY ("linkId") REFERENCES "SecureLink"("id") ON DELETE CASCADE ON UPDATE CASCADE;
