/**
 * Priority-based collaborative editing lock.
 *
 * Reuses: VendorAccess.level (priority), share-session auth, FileVersion, AuditLog, SSE.
 * Redis CAS is the lock source of truth. Frontend priority values are ignored.
 */

import { randomUUID } from 'crypto';
import { getEditLockConfig, type EditLockConfig } from './edit-lock-config';
import {
    decideAcceptTakeover,
    decideCompleteTakeover,
    decideHeartbeat,
    decideLockRequest,
    decideRelease,
    decideWrite,
} from './edit-lock-decision';
import { logEditLockAudit } from './edit-lock-audit';
import { snapshotForPriorityTakeover, touchUserFileLockedBy, PRIORITY_TAKEOVER_REASON } from './edit-lock-version';
import { serializeLock, withEditLockStore } from './edit-lock-store';
import {
    EditLockUnavailableError,
    parseEditingLock,
    toPublicLockView,
    type EditLockEvent,
    type EditingLock,
    type LockActor,
    type LockRequestOutcome,
    type PublicLockView,
} from './edit-lock-types';

const CAS_RETRIES = 8;

function makeEvent(
    type: EditLockEvent['type'],
    documentId: string,
    token: string,
    payload: Record<string, unknown>,
): EditLockEvent {
    return {
        id: randomUUID(),
        type,
        documentId,
        token,
        at: Date.now(),
        payload,
    };
}

async function casLoop<T>(
    documentId: string,
    ttlSeconds: number,
    apply: (current: EditingLock | null, expectedJson: string) => Promise<{
        next: EditingLock | null;
        result: T;
        skipWrite?: boolean;
        event?: EditLockEvent;
        token?: string;
    } | 'retry'>,
): Promise<T> {
    return withEditLockStore(async (store) => {
        for (let attempt = 0; attempt < CAS_RETRIES; attempt++) {
            const current = await store.get(documentId);
            const expectedJson = serializeLock(current);
            const decision = await apply(current, expectedJson);
            if (decision === 'retry') continue;
            if (decision.skipWrite) return decision.result;

            const cas = await store.cas(documentId, expectedJson, decision.next, ttlSeconds);
            if (!cas.ok) continue;

            if (decision.event && decision.token) {
                try {
                    await store.publishEvent(decision.token, decision.event);
                } catch {
                    // Notification is best-effort; lock CAS already succeeded.
                }
            }
            return decision.result;
        }
        throw new Error('EDIT_LOCK_CAS_CONFLICT');
    });
}

export async function getEditLockStatus(documentId: string, now = Date.now()): Promise<{
    lock: EditingLock | null;
    view: PublicLockView;
}> {
    const lock = await withEditLockStore((store) => store.get(documentId));
    const live = lock && lock.expiresAt > now ? lock : null;
    return {
        lock: live,
        view: { ...toPublicLockView(live, now)!, documentId },
    };
}

export async function getEditLockStatuses(
    documentIds: string[],
    now = Date.now(),
): Promise<Record<string, PublicLockView>> {
    if (documentIds.length === 0) return {};
    const locks = await withEditLockStore((store) => store.getMany(documentIds));
    const out: Record<string, PublicLockView> = {};
    documentIds.forEach((documentId, i) => {
        const lock = locks[i];
        const live = lock && lock.expiresAt > now ? lock : null;
        out[documentId] = { ...toPublicLockView(live, now)!, documentId };
    });
    return out;
}

export async function getEditLockEvent(token: string): Promise<EditLockEvent | null> {
    return withEditLockStore((store) => store.getEvent(token));
}

export async function requestEditLock(options: {
    documentId: string;
    linkId: string;
    actor: LockActor;
    now?: number;
    config?: EditLockConfig;
}): Promise<LockRequestOutcome> {
    const { documentId, linkId, actor } = options;
    const now = options.now ?? Date.now();
    const config = options.config ?? getEditLockConfig();

    try {
        return await casLoop<LockRequestOutcome>(documentId, config.ttlSeconds, async (current) => {
            const decision = decideLockRequest(current, actor, documentId, now, config);

            if (decision.kind === 'refresh') {
                return { next: decision.lock, result: { status: 'already_holder', lock: decision.lock } };
            }
            if (decision.kind === 'duplicate_tab') {
                return {
                    next: current,
                    skipWrite: true,
                    result: { status: 'duplicate_tab', lock: decision.lock },
                };
            }
            if (decision.kind === 'deny_higher_holder') {
                return {
                    next: current,
                    skipWrite: true,
                    result: { status: 'denied_higher_priority', lock: decision.lock },
                };
            }
            if (decision.kind === 'deny_same_priority') {
                return {
                    next: current,
                    skipWrite: true,
                    result: { status: 'denied_same_priority', lock: decision.lock },
                };
            }
            if (decision.kind === 'refresh_pending') {
                return {
                    next: decision.lock,
                    result: { status: 'takeover_pending', lock: decision.lock, repeat: true },
                };
            }
            if (decision.kind === 'already_pending') {
                const pending = decision.lock.pendingTakeover;
                const isSelf =
                    pending
                    && pending.requesterUserId === actor.userId
                    && pending.requesterSessionId === actor.sessionId;
                if (!isSelf) {
                    return {
                        next: current,
                        skipWrite: true,
                        result: {
                            status: pending?.mode === 'takeover' ? 'denied_higher_priority' : 'denied_same_priority',
                            lock: decision.lock,
                        },
                    };
                }
                return {
                    next: current,
                    skipWrite: true,
                    result: { status: 'takeover_pending', lock: decision.lock, repeat: true },
                };
            }

            if (decision.kind === 'acquire' || decision.kind === 'replace_own') {
                const event = makeEvent('priority_takeover_started', documentId, actor.token, {
                    documentId,
                    holder: {
                        userId: actor.userId,
                        userName: actor.userName,
                        priority: actor.priority,
                    },
                    generation: decision.lock.generation,
                });
                // acquire event is really lock acquired; use editing_lock via payload type on acquire
                const acquiredEvent = makeEvent('priority_access_accepted', documentId, actor.token, {
                    documentId,
                    holder: {
                        userId: actor.userId,
                        userName: actor.userName,
                        priority: actor.priority,
                    },
                    generation: decision.lock.generation,
                });
                void event;
                return {
                    next: decision.lock,
                    event: acquiredEvent,
                    token: actor.token,
                    result: { status: 'acquired', lock: decision.lock, event: acquiredEvent },
                };
            }

            // start_takeover
            const event = makeEvent('priority_access_requested', documentId, actor.token, {
                documentId,
                mode: decision.lock.pendingTakeover?.mode || 'takeover',
                requestedAt: decision.lock.pendingTakeover?.requestedAt,
                requester: {
                    userId: actor.userId,
                    userName: actor.userName,
                    priority: actor.priority,
                },
                currentEditor: {
                    userId: decision.lock.userId,
                    userName: decision.lock.userName,
                    priority: decision.lock.priority,
                },
                gracePeriodSeconds: config.gracePeriodSeconds,
            });
            return {
                next: decision.lock,
                event,
                token: actor.token,
                result: { status: 'takeover_pending', lock: decision.lock, event },
            };
        });
    } catch (err) {
        if (err instanceof EditLockUnavailableError) throw err;
        if (err instanceof Error && err.message === 'EDIT_LOCK_CAS_CONFLICT') {
            const { lock } = await getEditLockStatus(documentId, now);
            if (lock) {
                return { status: 'denied_same_priority', lock };
            }
        }
        throw err;
    } finally {
        // audit is written by caller after inspecting outcome so we have a single place
    }
}

export async function auditLockRequestOutcome(
    outcome: LockRequestOutcome,
    linkId: string,
    actor: LockActor,
    documentId: string,
): Promise<void> {
    if (outcome.status === 'acquired' || outcome.status === 'already_holder') {
        await logEditLockAudit('EDIT_LOCK_ACQUIRED', linkId, {
            actorUserId: actor.userId,
            documentId,
            teamId: actor.teamId,
            requesterPriority: actor.priority,
            sessionId: actor.sessionId,
            generation: outcome.lock.generation,
            reason: outcome.status === 'already_holder' ? 'REFRESH' : 'ACQUIRED',
        });
        await touchUserFileLockedBy(documentId, actor.userId);
        return;
    }
    if (outcome.status === 'takeover_pending') {
        if (outcome.repeat) return;
        await logEditLockAudit('PRIORITY_ACCESS_REQUESTED', linkId, {
            actorUserId: actor.userId,
            targetUserId: outcome.lock.userId,
            documentId,
            teamId: actor.teamId,
            previousPriority: outcome.lock.priority,
            requesterPriority: actor.priority,
            sessionId: actor.sessionId,
            reason: outcome.lock.pendingTakeover?.mode === 'request'
                ? 'EDIT_ACCESS_REQUESTED'
                : 'PRIORITY_ACCESS_REQUESTED',
        });
        return;
    }
    if (outcome.status === 'duplicate_tab') {
        await logEditLockAudit('EDIT_LOCK_DENIED', linkId, {
            actorUserId: actor.userId,
            documentId,
            teamId: actor.teamId,
            sessionId: actor.sessionId,
            reason: 'DUPLICATE_TAB',
        });
        return;
    }
    await logEditLockAudit('EDIT_LOCK_DENIED', linkId, {
        actorUserId: actor.userId,
        targetUserId: 'lock' in outcome ? outcome.lock.userId : null,
        documentId,
        teamId: actor.teamId,
        previousPriority: 'lock' in outcome ? outcome.lock.priority : null,
        requesterPriority: actor.priority,
        sessionId: actor.sessionId,
        reason: outcome.status,
    });
}

export async function heartbeatEditLock(options: {
    documentId: string;
    actor: LockActor;
    now?: number;
    config?: EditLockConfig;
}): Promise<{ ok: boolean; lock: EditingLock | null; reason?: string }> {
    const { documentId, actor } = options;
    const now = options.now ?? Date.now();
    const config = options.config ?? getEditLockConfig();

    return casLoop<{ ok: boolean; lock: EditingLock | null; reason?: string }>(documentId, config.ttlSeconds, async (current) => {
        const decision = decideHeartbeat(current, actor, now, config);
        if (decision.kind === 'missing') {
            return { next: current, skipWrite: true, result: { ok: false, lock: null, reason: 'missing' } };
        }
        if (decision.kind === 'not_holder') {
            return { next: current, skipWrite: true, result: { ok: false, lock: decision.lock, reason: 'not_holder' } };
        }
        return { next: decision.lock, result: { ok: true, lock: decision.lock } };
    });
}

export async function releaseEditLock(options: {
    documentId: string;
    linkId: string;
    actor: LockActor;
    now?: number;
    config?: EditLockConfig;
}): Promise<{ released: boolean; grantedTo: EditingLock | null; previous: EditingLock | null; reason?: string }> {
    const { documentId, linkId, actor } = options;
    const now = options.now ?? Date.now();
    const config = options.config ?? getEditLockConfig();

    const result = await casLoop<{ released: boolean; grantedTo: EditingLock | null; previous: EditingLock | null; reason?: string }>(documentId, config.ttlSeconds, async (current) => {
        const decision = decideRelease(current, actor, now, config);
        if (decision.kind === 'missing') {
            return { next: current, skipWrite: true, result: { released: false, grantedTo: null, previous: null, reason: 'missing' } };
        }
        if (decision.kind === 'not_holder') {
            return { next: current, skipWrite: true, result: { released: false, grantedTo: null, previous: decision.lock, reason: 'not_holder' } };
        }

        const event = decision.grantedTo
            ? makeEvent('priority_access_accepted', documentId, actor.token, {
                documentId,
                previousEditor: { userId: decision.previous.userId, userName: decision.previous.userName, priority: decision.previous.priority },
                holder: { userId: decision.grantedTo.userId, userName: decision.grantedTo.userName, priority: decision.grantedTo.priority },
                generation: decision.grantedTo.generation,
            })
            : makeEvent('editing_lock_released', documentId, actor.token, {
                documentId,
                previousEditor: { userId: decision.previous.userId, userName: decision.previous.userName, priority: decision.previous.priority },
            });

        return {
            next: decision.grantedTo,
            event,
            token: actor.token,
            result: { released: true, grantedTo: decision.grantedTo, previous: decision.previous },
        };
    });

    if (result.released) {
        await logEditLockAudit('EDIT_LOCK_RELEASED', linkId, {
            actorUserId: actor.userId,
            targetUserId: result.grantedTo?.userId ?? null,
            documentId,
            teamId: actor.teamId,
            previousPriority: result.previous?.priority ?? null,
            requesterPriority: result.grantedTo?.priority ?? null,
            sessionId: actor.sessionId,
            reason: result.grantedTo ? 'VOLUNTARY_RELEASE_GRANT_PENDING' : 'VOLUNTARY_RELEASE',
        });
        if (result.grantedTo) {
            await logEditLockAudit('PRIORITY_ACCESS_ACCEPTED', linkId, {
                actorUserId: actor.userId,
                targetUserId: result.grantedTo.userId,
                documentId,
                teamId: result.grantedTo.teamId,
                previousPriority: result.previous?.priority ?? null,
                requesterPriority: result.grantedTo.priority,
                sessionId: result.grantedTo.sessionId,
                reason: PRIORITY_TAKEOVER_REASON,
            });
            await touchUserFileLockedBy(documentId, result.grantedTo.userId);
        } else {
            await touchUserFileLockedBy(documentId, null);
        }
    }

    return result;
}

export async function acceptPriorityTakeover(options: {
    documentId: string;
    linkId: string;
    actor: LockActor;
    now?: number;
    config?: EditLockConfig;
}): Promise<{ ok: boolean; lock: EditingLock | null; reason?: string }> {
    const { documentId, linkId, actor } = options;
    const now = options.now ?? Date.now();
    const config = options.config ?? getEditLockConfig();

    const result = await casLoop<{ ok: boolean; lock: EditingLock | null; reason?: string }>(documentId, config.ttlSeconds, async (current) => {
        const decision = decideAcceptTakeover(current, actor, now, config);
        if (decision.kind === 'missing') {
            return { next: current, skipWrite: true, result: { ok: false, lock: null, reason: 'missing' } };
        }
        if (decision.kind === 'not_pending' || decision.kind === 'not_requester') {
            return { next: current, skipWrite: true, result: { ok: false, lock: decision.lock, reason: decision.kind } };
        }
        const event = makeEvent('priority_access_accepted', documentId, actor.token, {
            documentId,
            currentEditor: { userId: actor.userId, userName: actor.userName, priority: actor.priority },
            requester: current?.pendingTakeover
                ? {
                    userId: current.pendingTakeover.requesterUserId,
                    userName: current.pendingTakeover.requesterUserName,
                    priority: current.pendingTakeover.requesterPriority,
                }
                : null,
        });
        return {
            next: decision.lock,
            event,
            token: actor.token,
            result: { ok: true, lock: decision.lock },
        };
    });

    if (result.ok) {
        await logEditLockAudit('PRIORITY_ACCESS_ACCEPTED', linkId, {
            actorUserId: actor.userId,
            targetUserId: result.lock?.pendingTakeover?.requesterUserId,
            documentId,
            teamId: actor.teamId,
            previousPriority: actor.priority,
            requesterPriority: result.lock?.pendingTakeover?.requesterPriority,
            sessionId: actor.sessionId,
            reason: 'HOLDER_ACCEPTED',
        });
    }
    return result;
}

export async function completePriorityTakeover(options: {
    documentId: string;
    linkId: string;
    actor: LockActor;
    now?: number;
    config?: EditLockConfig;
    /** When holder already accepted, allow complete before grace expires. */
    forceAfterAccept?: boolean;
    /** Higher-priority requester explicitly takes over (no countdown). */
    forceImmediate?: boolean;
}): Promise<{
    ok: boolean;
    lock: EditingLock | null;
    previous: EditingLock | null;
    snapshot?: Awaited<ReturnType<typeof snapshotForPriorityTakeover>>;
    reason?: string;
    remainingMs?: number;
}> {
    const { documentId, linkId, actor } = options;
    const now = options.now ?? Date.now();
    const config = options.config ?? getEditLockConfig();

    const precheck = await withEditLockStore((store) => store.get(documentId));
    const preDecision = decideCompleteTakeover(precheck, actor, now, config, options.forceAfterAccept, options.forceImmediate);
    if (preDecision.kind === 'too_early') {
        return { ok: false, lock: preDecision.lock, previous: null, reason: 'too_early', remainingMs: preDecision.remainingMs };
    }
    if (preDecision.kind === 'missing') {
        return { ok: false, lock: null, previous: null, reason: 'missing' };
    }
    if (preDecision.kind === 'not_pending' || preDecision.kind === 'not_requester') {
        return { ok: false, lock: preDecision.lock, previous: null, reason: preDecision.kind };
    }

    await logEditLockAudit('PRIORITY_TAKEOVER_STARTED', linkId, {
        actorUserId: actor.userId,
        targetUserId: precheck?.userId,
        documentId,
        teamId: actor.teamId,
        previousPriority: precheck?.priority,
        requesterPriority: actor.priority,
        sessionId: actor.sessionId,
        reason: PRIORITY_TAKEOVER_REASON,
    });
    await logEditLockAudit('AUTO_SAVE_BEFORE_TAKEOVER', linkId, {
        actorUserId: precheck?.userId,
        targetUserId: actor.userId,
        documentId,
        teamId: precheck?.teamId,
        previousPriority: precheck?.priority,
        requesterPriority: actor.priority,
        sessionId: precheck?.sessionId,
        reason: PRIORITY_TAKEOVER_REASON,
    });

    const snapshot = await snapshotForPriorityTakeover({
        fileId: documentId,
        linkId,
        createdBy: precheck?.userId || 'unknown',
        actorSessionId: precheck?.sessionId,
    });

    if (!snapshot.success) {
        await logEditLockAudit('AUTO_SAVE_BEFORE_TAKEOVER', linkId, {
            actorUserId: precheck?.userId,
            documentId,
            sessionId: precheck?.sessionId,
            reason: 'AUTO_SAVE_FAILED',
            error: snapshot.error,
        });
        return { ok: false, lock: precheck, previous: null, snapshot, reason: 'snapshot_failed' };
    }

    const result = await casLoop<{
        ok: boolean;
        lock: EditingLock | null;
        previous: EditingLock | null;
        snapshot?: Awaited<ReturnType<typeof snapshotForPriorityTakeover>>;
        reason?: string;
        remainingMs?: number;
    }>(documentId, config.ttlSeconds, async (current) => {
        const decision = decideCompleteTakeover(current, actor, now, config, options.forceAfterAccept, options.forceImmediate);
        if (decision.kind !== 'completed') {
            return {
                next: current,
                skipWrite: true,
                result: {
                    ok: false,
                    lock: 'lock' in decision ? decision.lock : current,
                    previous: null,
                    reason: decision.kind,
                    remainingMs: decision.kind === 'too_early' ? decision.remainingMs : undefined,
                },
            };
        }

        const revokeEvent = makeEvent('editing_session_revoked', documentId, actor.token, {
            documentId,
            previousEditor: {
                userId: decision.previous.userId,
                userName: decision.previous.userName,
                priority: decision.previous.priority,
                sessionId: decision.previous.sessionId,
            },
            holder: {
                userId: decision.lock.userId,
                userName: decision.lock.userName,
                priority: decision.lock.priority,
            },
            generation: decision.lock.generation,
            versionId: snapshot.versionId,
        });
        const startedEvent = makeEvent('priority_takeover_started', documentId, actor.token, revokeEvent.payload);
        void startedEvent;

        const versionEvent = makeEvent('document_version_created', documentId, actor.token, {
            documentId,
            versionId: snapshot.versionId,
            versionNumber: snapshot.versionNumber,
            createdBy: precheck?.userId,
            reason: PRIORITY_TAKEOVER_REASON,
            previousVersionId: snapshot.previousVersionId,
        });
        void versionEvent;

        return {
            next: decision.lock,
            event: revokeEvent,
            token: actor.token,
            result: {
                ok: true,
                lock: decision.lock,
                previous: decision.previous,
                snapshot,
            },
        };
    });

    if (result.ok && result.previous && result.lock) {
        await logEditLockAudit('LOW_PRIORITY_SESSION_REVOKED', linkId, {
            actorUserId: actor.userId,
            targetUserId: result.previous.userId,
            documentId,
            teamId: actor.teamId,
            previousPriority: result.previous.priority,
            requesterPriority: actor.priority,
            sessionId: result.previous.sessionId,
            reason: PRIORITY_TAKEOVER_REASON,
            generation: result.lock.generation,
        });
        await logEditLockAudit('PRIORITY_TAKEOVER_COMPLETED', linkId, {
            actorUserId: actor.userId,
            targetUserId: result.previous.userId,
            documentId,
            teamId: actor.teamId,
            previousPriority: result.previous.priority,
            requesterPriority: actor.priority,
            sessionId: actor.sessionId,
            reason: PRIORITY_TAKEOVER_REASON,
            generation: result.lock.generation,
            versionId: snapshot.versionId,
        });
        await touchUserFileLockedBy(documentId, result.lock.userId);
    }

    return result;
}

export async function assertActorHoldsEditLock(options: {
    documentId: string;
    actor: LockActor;
    now?: number;
}): Promise<{ ok: true; lock: EditingLock } | { ok: false; reason: string; lock: EditingLock | null }> {
    const { documentId, actor } = options;
    const now = options.now ?? Date.now();
    try {
        const { lock } = await getEditLockStatus(documentId, now);
        const decision = decideWrite(lock, actor, now);
        if (!decision.allowed) {
            return { ok: false, reason: decision.reason, lock };
        }
        return { ok: true, lock: decision.lock };
    } catch (err) {
        if (err instanceof EditLockUnavailableError) {
            return { ok: false, reason: 'lock_unavailable', lock: null };
        }
        throw err;
    }
}

export function parseLockFromCasCurrent(raw: string): EditingLock | null {
    return parseEditingLock(raw);
}

export { toPublicLockView, EditLockUnavailableError };
export { setEditLockStoreForTests, resetMemoryEditLockStoreForTests } from './edit-lock-store';
