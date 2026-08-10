/**
 * Active-access-session device binding helpers.
 *
 * Binding lives on the recipient's ACTIVE session (VendorAccess.activeDeviceHash
 * + Redis SessionData.deviceFingerprint), never on the share-link creator.
 */

export const DEVICE_MISMATCH_ERROR =
    'Access denied: Link is bound to a different device/browser.';

export function isSessionDeviceMismatch(
    boundDeviceHash: string | null | undefined,
    currentDeviceHash: string,
): boolean {
    if (!boundDeviceHash) return false;
    return boundDeviceHash !== currentDeviceHash;
}
