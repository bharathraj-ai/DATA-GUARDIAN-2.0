export const EDIT_LOCK_KEY_PREFIX = 'document:editing-lock:';
export const EDIT_LOCK_EVENT_KEY_PREFIX = 'document:editing-lock-event:';

export type EditLockEventType =
    | 'priority_access_requested'
    | 'priority_access_accepted'
    | 'priority_takeover_started'
    | 'editing_lock_released'
    | 'editing_session_revoked'
    | 'document_version_created';

export type PendingTakeoverStatus = 'requested' | 'accepted' | 'completing';
export type PendingAccessMode = 'takeover' | 'request';

export interface PendingTakeover {
    requesterUserId: string;
    requesterUserName: string;
    requesterPriority: number;
    requesterSessionId: string;
    requesterClientInstanceId: string;
    requesterTeamId: string;
    requestedAt: number;
    graceEndsAt: number;
    status: PendingTakeoverStatus;
    /** takeover = higher priority can force; request = lower/same, notify only */
    mode?: PendingAccessMode;
}

export interface EditingLock {
    documentId: string;
    userId: string;
    userName: string;
    teamId: string;
    priority: number;
    sessionId: string;
    clientInstanceId: string;
    acquiredAt: number;
    lastHeartbeat: number;
    expiresAt: number;
    reservedUntil: number;
    generation: number;
    token: string;
    pendingTakeover: PendingTakeover | null;
}

export interface LockActor {
    userId: string;
    userName: string;
    teamId: string;
    /** Server-derived VendorAccess.level (or 1 for owner). Never trust the client. */
    priority: number;
    sessionId: string;
    clientInstanceId: string;
    token: string;
    isOwner: boolean;
}

export interface PublicLockView {
    documentId: string;
    holder: {
        userId: string;
        userName: string;
        teamId: string;
        priority: number;
        sessionId: string;
        acquiredAt: number;
        lastHeartbeat: number;
        expiresAt: number;
        reservedUntil: number;
    } | null;
    pendingTakeover: {
        requesterUserId: string;
        requesterUserName: string;
        requesterPriority: number;
        requestedAt: number;
        graceEndsAt: number;
        graceRemainingSeconds: number;
        status: PendingTakeoverStatus;
        mode?: PendingAccessMode;
    } | null;
    generation: number;
}

export interface EditLockEvent {
    id: string;
    type: EditLockEventType;
    documentId: string;
    token: string;
    at: number;
    payload: Record<string, unknown>;
}

export type LockRequestOutcome =
    | { status: 'acquired'; lock: EditingLock; event?: EditLockEvent }
    | { status: 'already_holder'; lock: EditingLock }
    | { status: 'takeover_pending'; lock: EditingLock; event?: EditLockEvent; repeat?: boolean }
    | { status: 'duplicate_tab'; lock: EditingLock }
    | { status: 'denied_higher_priority'; lock: EditingLock }
    | { status: 'denied_same_priority'; lock: EditingLock }
    | { status: 'denied_no_access'; error: string };

export class EditLockUnavailableError extends Error {
    constructor(message = 'Editing lock service unavailable') {
        super(message);
        this.name = 'EditLockUnavailableError';
    }
}

export function editLockKey(documentId: string): string {
    return `${EDIT_LOCK_KEY_PREFIX}${documentId}`;
}

export function editLockEventKey(token: string): string {
    return `${EDIT_LOCK_EVENT_KEY_PREFIX}${token}`;
}

export function toPublicLockView(lock: EditingLock | null, now = Date.now()): PublicLockView | null {
    if (!lock) {
        return {
            documentId: '',
            holder: null,
            pendingTakeover: null,
            generation: 0,
        };
    }
    const pending = lock.pendingTakeover;
    return {
        documentId: lock.documentId,
        holder: {
            userId: lock.userId,
            userName: lock.userName,
            teamId: lock.teamId,
            priority: lock.priority,
            sessionId: lock.sessionId,
            acquiredAt: lock.acquiredAt,
            lastHeartbeat: lock.lastHeartbeat,
            expiresAt: lock.expiresAt,
            reservedUntil: lock.reservedUntil,
        },
        pendingTakeover: pending
            ? {
                requesterUserId: pending.requesterUserId,
                requesterUserName: pending.requesterUserName,
                requesterPriority: pending.requesterPriority,
                requestedAt: pending.requestedAt,
                graceEndsAt: pending.graceEndsAt,
                graceRemainingSeconds: Math.max(0, Math.ceil((pending.graceEndsAt - now) / 1000)),
                status: pending.status,
                mode: pending.mode || 'takeover',
            }
            : null,
        generation: lock.generation,
    };
}

export function parseEditingLock(raw: unknown): EditingLock | null {
    if (!raw) return null;
    let obj: unknown = raw;
    if (typeof raw === 'string') {
        try {
            obj = JSON.parse(raw);
        } catch {
            return null;
        }
    }
    if (!obj || typeof obj !== 'object') return null;
    const lock = obj as EditingLock;
    if (!lock.documentId || !lock.userId || !lock.sessionId || typeof lock.priority !== 'number') {
        return null;
    }
    return lock;
}
