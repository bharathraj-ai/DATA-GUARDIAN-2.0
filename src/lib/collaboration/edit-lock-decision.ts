import type { EditLockConfig } from './edit-lock-config';
import type { EditingLock, LockActor, PendingAccessMode, PendingTakeover } from './edit-lock-types';
import { hasEqualPriority, hasHigherPriority } from './priority';

export type RequestDecision =
    | { kind: 'acquire'; lock: EditingLock }
    | { kind: 'refresh'; lock: EditingLock }
    | { kind: 'replace_own'; lock: EditingLock }
    | { kind: 'duplicate_tab'; lock: EditingLock }
    | { kind: 'start_takeover'; lock: EditingLock }
    | { kind: 'already_pending'; lock: EditingLock }
    | { kind: 'refresh_pending'; lock: EditingLock }
    | { kind: 'deny_higher_holder'; lock: EditingLock }
    | { kind: 'deny_same_priority'; lock: EditingLock };

export type HeartbeatDecision =
    | { kind: 'ok'; lock: EditingLock }
    | { kind: 'missing' }
    | { kind: 'not_holder'; lock: EditingLock }
    | { kind: 'revoked'; lock: EditingLock };

export type ReleaseDecision =
    | { kind: 'released'; previous: EditingLock; grantedTo: EditingLock | null }
    | { kind: 'not_holder'; lock: EditingLock | null }
    | { kind: 'missing' };

export type TakeoverDecision =
    | { kind: 'completed'; previous: EditingLock; lock: EditingLock }
    | { kind: 'too_early'; lock: EditingLock; remainingMs: number }
    | { kind: 'accepted_waiting'; lock: EditingLock }
    | { kind: 'not_requester'; lock: EditingLock | null }
    | { kind: 'missing' }
    | { kind: 'not_pending'; lock: EditingLock };

export type WriteDecision =
    | { allowed: true; lock: EditingLock }
    | { allowed: false; reason: 'no_lock' | 'not_holder' | 'lock_expired' | 'session_revoked' };

function isExpired(lock: EditingLock, now: number): boolean {
    return lock.expiresAt <= now;
}

function isStaleHeartbeat(lock: EditingLock, now: number, staleMs: number): boolean {
    return now - lock.lastHeartbeat > staleMs;
}

function newLock(actor: LockActor, documentId: string, now: number, config: EditLockConfig, generation: number): EditingLock {
    return {
        documentId,
        userId: actor.userId,
        userName: actor.userName,
        teamId: actor.teamId,
        priority: actor.priority,
        sessionId: actor.sessionId,
        clientInstanceId: actor.clientInstanceId,
        acquiredAt: now,
        lastHeartbeat: now,
        expiresAt: now + config.ttlSeconds * 1000,
        reservedUntil: config.reservationSeconds > 0 ? now + config.reservationSeconds * 1000 : now,
        generation,
        token: actor.token,
        pendingTakeover: null,
    };
}

function isSameRequester(pending: PendingTakeover | null | undefined, actor: LockActor): boolean {
    return Boolean(pending && pending.requesterUserId === actor.userId);
}

function refreshPendingRequester(lock: EditingLock, actor: LockActor): EditingLock {
    const pending = lock.pendingTakeover;
    if (!pending) return lock;
    return {
        ...lock,
        pendingTakeover: {
            ...pending,
            requesterSessionId: actor.sessionId,
            requesterClientInstanceId: actor.clientInstanceId || pending.requesterClientInstanceId,
            requesterUserName: actor.userName || pending.requesterUserName,
        },
    };
}

function sameRequesterDecision(lock: EditingLock, actor: LockActor): RequestDecision {
    const pending = lock.pendingTakeover!;
    if (
        pending.requesterSessionId === actor.sessionId
        && pending.requesterClientInstanceId === actor.clientInstanceId
    ) {
        return { kind: 'already_pending', lock };
    }
    return { kind: 'refresh_pending', lock: refreshPendingRequester(lock, actor) };
}

function makePending(actor: LockActor, now: number, config: EditLockConfig, mode: PendingAccessMode): PendingTakeover {
    return {
        requesterUserId: actor.userId,
        requesterUserName: actor.userName,
        requesterPriority: actor.priority,
        requesterSessionId: actor.sessionId,
        requesterClientInstanceId: actor.clientInstanceId,
        requesterTeamId: actor.teamId,
        requestedAt: now,
        graceEndsAt:
            mode === 'takeover' && config.gracePeriodSeconds > 0
                ? now + config.gracePeriodSeconds * 1000
                : 0,
        status: 'requested',
        mode,
    };
}

function refreshHolder(lock: EditingLock, now: number, config: EditLockConfig): EditingLock {
    return {
        ...lock,
        lastHeartbeat: now,
        expiresAt: now + config.ttlSeconds * 1000,
    };
}

export function decideLockRequest(
    current: EditingLock | null,
    actor: LockActor,
    documentId: string,
    now: number,
    config: EditLockConfig,
): RequestDecision {
    if (!current || isExpired(current, now)) {
        return { kind: 'acquire', lock: newLock(actor, documentId, now, config, (current?.generation ?? 0) + 1) };
    }

    const sameUser = current.userId === actor.userId;
    const sameSession = current.sessionId === actor.sessionId;
    const sameTab = current.clientInstanceId === actor.clientInstanceId && Boolean(actor.clientInstanceId);

    if (sameUser && sameSession && sameTab) {
        return { kind: 'refresh', lock: refreshHolder(current, now, config) };
    }

    if (sameUser && sameSession && !sameTab && actor.clientInstanceId) {
        if (!isStaleHeartbeat(current, now, config.staleHeartbeatMs)) {
            return { kind: 'duplicate_tab', lock: current };
        }
        // Dead tab / sleep-wake: reclaim with this instance.
        return {
            kind: 'replace_own',
            lock: {
                ...newLock(actor, documentId, now, config, current.generation + 1),
                acquiredAt: current.acquiredAt,
                reservedUntil: current.reservedUntil,
            },
        };
    }

    if (sameUser && (!sameSession || isStaleHeartbeat(current, now, config.staleHeartbeatMs))) {
        return {
            kind: 'replace_own',
            lock: {
                ...newLock(actor, documentId, now, config, current.generation + 1),
                acquiredAt: current.acquiredAt,
                reservedUntil: Math.max(current.reservedUntil, now + config.reservationSeconds * 1000),
            },
        };
    }

    if (hasHigherPriority(actor.priority, current.priority)) {
        const pending = current.pendingTakeover;
        if (isSameRequester(pending, actor)) {
            return sameRequesterDecision(current, actor);
        }
        if (
            pending
            && pending.mode === 'takeover'
            && !hasHigherPriority(actor.priority, pending.requesterPriority)
            && pending.requesterUserId !== actor.userId
        ) {
            return { kind: 'already_pending', lock: current };
        }
        const takeover = makePending(actor, now, config, 'takeover');
        return {
            kind: 'start_takeover',
            lock: {
                ...current,
                expiresAt: Math.max(
                    current.expiresAt,
                    takeover.graceEndsAt > 0 ? takeover.graceEndsAt + config.ttlSeconds * 1000 : current.expiresAt,
                ),
                pendingTakeover: takeover,
            },
        };
    }

    // Lower or same priority: notify current editor. Cannot force takeover unless policy allows same-priority.
    const pending = current.pendingTakeover;
    if (isSameRequester(pending, actor)) {
        return sameRequesterDecision(current, actor);
    }
    if (pending?.mode === 'takeover' && pending.requesterUserId !== actor.userId) {
        return { kind: 'already_pending', lock: current };
    }
    if (hasEqualPriority(actor.priority, current.priority) && config.samePriorityPolicy === 'allow_takeover') {
        const takeover = makePending(actor, now, config, 'takeover');
        return { kind: 'start_takeover', lock: { ...current, pendingTakeover: takeover } };
    }
    if (pending?.mode === 'request' && pending.requesterUserId !== actor.userId) {
        return { kind: 'already_pending', lock: current };
    }

    const request = makePending(actor, now, config, 'request');
    return {
        kind: 'start_takeover',
        lock: { ...current, pendingTakeover: request },
    };
}

export function decideHeartbeat(
    current: EditingLock | null,
    actor: LockActor,
    now: number,
    config: EditLockConfig,
): HeartbeatDecision {
    if (!current || isExpired(current, now)) return { kind: 'missing' };
    if (current.sessionId !== actor.sessionId || current.userId !== actor.userId) {
        if (
            current.pendingTakeover?.requesterUserId === actor.userId
            || current.pendingTakeover?.requesterSessionId === actor.sessionId
        ) {
            return { kind: 'ok', lock: current };
        }
        return { kind: 'not_holder', lock: current };
    }
    if (actor.clientInstanceId && current.clientInstanceId && current.clientInstanceId !== actor.clientInstanceId) {
        return { kind: 'not_holder', lock: current };
    }
    return { kind: 'ok', lock: refreshHolder(current, now, config) };
}

export function decideRelease(
    current: EditingLock | null,
    actor: LockActor,
    now: number,
    config: EditLockConfig,
): ReleaseDecision {
    if (!current || isExpired(current, now)) return { kind: 'missing' };
    const isHolder = current.sessionId === actor.sessionId && current.userId === actor.userId;
    if (!isHolder) return { kind: 'not_holder', lock: current };

    const pending = current.pendingTakeover;
    if (pending) {
        const granted: EditingLock = {
            documentId: current.documentId,
            userId: pending.requesterUserId,
            userName: pending.requesterUserName,
            teamId: pending.requesterTeamId,
            priority: pending.requesterPriority,
            sessionId: pending.requesterSessionId,
            clientInstanceId: pending.requesterClientInstanceId,
            acquiredAt: now,
            lastHeartbeat: now,
            expiresAt: now + config.ttlSeconds * 1000,
            reservedUntil: config.reservationSeconds > 0 ? now + config.reservationSeconds * 1000 : now,
            generation: current.generation + 1,
            token: current.token,
            pendingTakeover: null,
        };
        return { kind: 'released', previous: current, grantedTo: granted };
    }
    return { kind: 'released', previous: current, grantedTo: null };
}

export function decideAcceptTakeover(
    current: EditingLock | null,
    actor: LockActor,
    now: number,
    config: EditLockConfig,
): TakeoverDecision {
    if (!current || isExpired(current, now)) return { kind: 'missing' };
    const pending = current.pendingTakeover;
    if (!pending) return { kind: 'not_pending', lock: current };
    const isHolder = current.sessionId === actor.sessionId && current.userId === actor.userId;
    if (!isHolder) return { kind: 'not_requester', lock: current };
    return {
        kind: 'accepted_waiting',
        lock: {
            ...refreshHolder(current, now, config),
            pendingTakeover: { ...pending, status: 'accepted' },
        },
    };
}

export function decideCompleteTakeover(
    current: EditingLock | null,
    actor: LockActor,
    now: number,
    config: EditLockConfig,
    forceAfterAccept = false,
    forceImmediate = false,
): TakeoverDecision {
    if (!current || isExpired(current, now)) return { kind: 'missing' };
    const pending = current.pendingTakeover;
    if (!pending) return { kind: 'not_pending', lock: current };

    const isRequester =
        pending.requesterSessionId === actor.sessionId && pending.requesterUserId === actor.userId;
    if (!isRequester) return { kind: 'not_requester', lock: current };

    const mode = pending.mode || 'takeover';
    if (forceImmediate && mode === 'request') {
        return { kind: 'too_early', lock: current, remainingMs: -1 };
    }

    const timedGrace = pending.graceEndsAt > 0 && config.gracePeriodSeconds > 0 && mode === 'takeover';
    const graceOver = timedGrace && now >= pending.graceEndsAt;
    const accepted = pending.status === 'accepted' || pending.status === 'completing';
    if (!forceImmediate && !graceOver && !(forceAfterAccept && accepted)) {
        return {
            kind: 'too_early',
            lock: current,
            remainingMs: timedGrace ? pending.graceEndsAt - now : -1,
        };
    }

    const next: EditingLock = {
        documentId: current.documentId,
        userId: pending.requesterUserId,
        userName: pending.requesterUserName,
        teamId: pending.requesterTeamId,
        priority: pending.requesterPriority,
        sessionId: pending.requesterSessionId,
        clientInstanceId: pending.requesterClientInstanceId,
        acquiredAt: now,
        lastHeartbeat: now,
        expiresAt: now + config.ttlSeconds * 1000,
        reservedUntil: config.reservationSeconds > 0 ? now + config.reservationSeconds * 1000 : now,
        generation: current.generation + 1,
        token: current.token,
        pendingTakeover: null,
    };
    return { kind: 'completed', previous: current, lock: next };
}

export function decideWrite(
    current: EditingLock | null,
    actor: LockActor,
    now: number,
): WriteDecision {
    if (!current) return { allowed: false, reason: 'no_lock' };
    if (isExpired(current, now)) return { allowed: false, reason: 'lock_expired' };
    if (current.userId !== actor.userId || current.sessionId !== actor.sessionId) {
        return { allowed: false, reason: 'not_holder' };
    }
    return { allowed: true, lock: current };
}

export function buildLockActorLock(
    actor: LockActor,
    documentId: string,
    now: number,
    config: EditLockConfig,
    generation: number,
): EditingLock {
    return newLock(actor, documentId, now, config, generation);
}
