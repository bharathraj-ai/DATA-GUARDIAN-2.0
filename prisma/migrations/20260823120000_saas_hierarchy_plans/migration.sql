-- SaaS hierarchy: plans, org member roles, manager reports, invites.
-- Migrate legacy User.role OWNER → TEAM_LEADER and org member roles.

ALTER TABLE "Organization" ADD COLUMN IF NOT EXISTS "plan" TEXT NOT NULL DEFAULT 'FREE';
ALTER TABLE "Organization" ADD COLUMN IF NOT EXISTS "suspendedAt" TIMESTAMP(3);

CREATE INDEX IF NOT EXISTS "Organization_plan_idx" ON "Organization"("plan");

ALTER TABLE "OrganizationMember" ADD COLUMN IF NOT EXISTS "managerUserId" TEXT;

CREATE INDEX IF NOT EXISTS "OrganizationMember_managerUserId_idx" ON "OrganizationMember"("managerUserId");
CREATE INDEX IF NOT EXISTS "OrganizationMember_organizationId_role_idx" ON "OrganizationMember"("organizationId", "role");

UPDATE "OrganizationMember" SET "role" = 'COMPANY' WHERE "role" = 'ADMIN';
UPDATE "OrganizationMember" SET "role" = 'TEAM_LEADER' WHERE "role" IN ('MEMBER', 'OWNER');

UPDATE "User" SET "role" = 'TEAM_LEADER' WHERE UPPER("role") = 'OWNER';

CREATE TABLE IF NOT EXISTS "OrganizationInvite" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "managerUserId" TEXT,
    "invitedById" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "acceptedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OrganizationInvite_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "OrganizationInvite_token_key" ON "OrganizationInvite"("token");
CREATE UNIQUE INDEX IF NOT EXISTS "OrganizationInvite_organizationId_email_key" ON "OrganizationInvite"("organizationId", "email");
CREATE INDEX IF NOT EXISTS "OrganizationInvite_email_idx" ON "OrganizationInvite"("email");
CREATE INDEX IF NOT EXISTS "OrganizationInvite_token_idx" ON "OrganizationInvite"("token");
CREATE INDEX IF NOT EXISTS "OrganizationInvite_expiresAt_idx" ON "OrganizationInvite"("expiresAt");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'OrganizationInvite_organizationId_fkey'
  ) THEN
    ALTER TABLE "OrganizationInvite"
      ADD CONSTRAINT "OrganizationInvite_organizationId_fkey"
      FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
