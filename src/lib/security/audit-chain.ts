import crypto from 'crypto';

function auditSecret(): string {
    const dedicated = process.env.AUDIT_HMAC_SECRET?.trim();
    if (dedicated) return dedicated;

    // Production must use a dedicated audit secret (no session-secret fallback).
    if (process.env.NODE_ENV === 'production' && process.env.NEXT_PHASE !== 'phase-production-build') {
        throw new Error('AUDIT_HMAC_SECRET is required for audit chaining in production');
    }

    const fallback = process.env.SESSION_HMAC_SECRET?.trim();
    if (!fallback) {
        throw new Error('AUDIT_HMAC_SECRET is required for audit chaining');
    }
    return fallback;
}

export function hashAuditEntry(params: {
    prevHash: string;
    action: string;
    timestamp: string;
    linkId: string;
    ownerId: string;
    reason: string;
    metadata: string;
}): string {
    const payload = [
        params.prevHash,
        params.action,
        params.timestamp,
        params.linkId,
        params.ownerId,
        params.reason,
        params.metadata,
    ].join('|');
    return crypto.createHmac('sha256', auditSecret()).update(payload).digest('hex');
}

export function verifyAuditEntry(
    params: {
        prevHash: string;
        action: string;
        timestamp: string;
        linkId: string;
        ownerId: string;
        reason: string;
        metadata: string;
    },
    entryHash: string,
): boolean {
    const expected = hashAuditEntry(params);
    const a = Buffer.from(expected, 'hex');
    const b = Buffer.from(entryHash, 'hex');
    if (a.length !== b.length) return false;
    return crypto.timingSafeEqual(a, b);
}
