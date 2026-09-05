/**
 * Forensic watermark helpers for leak attribution (OS snip / phone camera).
 * Does not prevent capture — identifies who was viewing when a frame was photographed.
 */

export type ForensicWatermarkInput = {
    viewerEmail?: string | null;
    token: string;
    deviceHash?: string | null;
    /** ISO or display timestamp; defaults to current UTC minute. */
    at?: Date;
};

export type ForensicWatermarkParts = {
    email: string;
    tokenFragment: string;
    deviceFragment: string;
    timestamp: string;
    line: string;
};

export function buildForensicWatermark(input: ForensicWatermarkInput): ForensicWatermarkParts {
    const email = (input.viewerEmail || 'Protected Session').trim().slice(0, 80);
    const tokenFragment = (input.token || '').replace(/\s+/g, '').slice(0, 8) || '--------';
    const deviceFragment = (input.deviceHash || '').replace(/\s+/g, '').slice(0, 8) || 'nodevice';
    const at = input.at ?? new Date();
    const timestamp = at.toISOString().replace(/\.\d{3}Z$/, 'Z');
    const line = `${email} · ${tokenFragment} · ${deviceFragment} · ${timestamp}`;
    return { email, tokenFragment, deviceFragment, timestamp, line };
}

/** Dense tile count for overlay rows (camera-visible). */
export const FORENSIC_WATERMARK_ROWS = 12;
