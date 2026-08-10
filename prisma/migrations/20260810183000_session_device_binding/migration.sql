-- Bind device fingerprint to the active recipient access session (not the share link creator).
ALTER TABLE "VendorAccess" ADD COLUMN IF NOT EXISTS "activeDeviceHash" TEXT;
