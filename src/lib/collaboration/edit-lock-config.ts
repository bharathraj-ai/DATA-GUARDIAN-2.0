/**
 * Priority-based editing lock configuration.
 * Lower numeric priority = higher authority (same as VendorAccess.level).
 */

export type SamePriorityPolicy = 'keep_current' | 'allow_takeover';

function envInt(name: string, fallback: number, min: number, max: number): number {
    const raw = process.env[name];
    const n = raw ? parseInt(raw, 10) : fallback;
    if (!Number.isFinite(n)) return fallback;
    return Math.min(max, Math.max(min, n));
}

export function getEditLockConfig() {
    const samePriority = (process.env.EDIT_LOCK_SAME_PRIORITY_POLICY || 'keep_current').toLowerCase();
    return {
        /** Redis lock TTL; holder must heartbeat before this elapses. */
        ttlSeconds: envInt('EDIT_LOCK_TTL_SECONDS', 120, 30, 600),
        /** Optional warning window. 0 = no countdown; editor Allows or higher-priority forces. */
        gracePeriodSeconds: envInt('EDIT_LOCK_GRACE_PERIOD_SECONDS', 0, 0, 3600),
        /** Optional reservation display only. 0 = none. Does NOT block higher-priority takeover. */
        reservationSeconds: envInt('EDIT_LOCK_RESERVATION_SECONDS', 0, 0, 8 * 3600),
        maxReservationSeconds: envInt('EDIT_LOCK_MAX_RESERVATION_SECONDS', 8 * 3600, 60, 24 * 3600),
        samePriorityPolicy: (samePriority === 'allow_takeover' ? 'allow_takeover' : 'keep_current') as SamePriorityPolicy,
        /** Heartbeats older than this are treated as a dead tab (same-user reclaim). */
        staleHeartbeatMs: envInt('EDIT_LOCK_STALE_HEARTBEAT_MS', 90_000, 5_000, 180_000),
    };
}

export type EditLockConfig = ReturnType<typeof getEditLockConfig>;
