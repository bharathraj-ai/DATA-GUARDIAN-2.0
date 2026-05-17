-- Remove plaintext OTP columns (hashes only; OTP delivered via email at creation time)
ALTER TABLE "SecureLink" DROP COLUMN IF EXISTS "otpPlain";
ALTER TABLE "VendorAccess" DROP COLUMN IF EXISTS "otpPlain";
ALTER TABLE "LinkAccess" DROP COLUMN IF EXISTS "otpPlain";

-- Enforce unique file versions (concurrent save safety)
CREATE UNIQUE INDEX IF NOT EXISTS "FileVersion_fileId_versionNumber_key" ON "FileVersion"("fileId", "versionNumber");

-- Document sharing grants (deny-by-default document access)
CREATE TABLE IF NOT EXISTS "DocumentGrant" (
    "id" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "granteeId" TEXT NOT NULL,
    "permission" TEXT NOT NULL DEFAULT 'view',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "DocumentGrant_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "DocumentGrant_documentId_granteeId_key" ON "DocumentGrant"("documentId", "granteeId");
CREATE INDEX IF NOT EXISTS "DocumentGrant_granteeId_idx" ON "DocumentGrant"("granteeId");

DO $$ BEGIN
 ALTER TABLE "DocumentGrant" ADD CONSTRAINT "DocumentGrant_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "Document"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
 WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
 ALTER TABLE "DocumentGrant" ADD CONSTRAINT "DocumentGrant_granteeId_fkey" FOREIGN KEY ("granteeId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
 WHEN duplicate_object THEN NULL;
END $$;
