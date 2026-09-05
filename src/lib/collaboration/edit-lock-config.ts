/**
 * Priority-based editing lock configuration.
 * Lower numeric priority = higher authority (same as VendorAccess.level).
 *
 * Group edit has no countdown and no reservation clock. Higher priority
 * requests access; the holder Allows or they Take over now.
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
        /** Always 0 — no takeover countdown. */
        gracePeriodSeconds: 0,
        /** Always 0 — reservation does not block higher-priority takeover. */
        reservationSeconds: 0,
        maxReservationSeconds: 0,
        samePriorityPolicy: (samePriority === 'allow_takeover' ? 'allow_takeover' : 'keep_current') as SamePriorityPolicy,
        /** Heartbeats older than this are treated as a dead tab (same-user reclaim). */
        staleHeartbeatMs: envInt('EDIT_LOCK_STALE_HEARTBEAT_MS', 90_000, 5_000, 180_000),
    };
}

export type EditLockConfig = ReturnType<typeof getEditLockConfig>;
