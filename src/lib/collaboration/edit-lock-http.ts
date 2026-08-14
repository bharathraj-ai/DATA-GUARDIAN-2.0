import { NextRequest, NextResponse } from 'next/server';
import { authorizeApiRequest } from '@/lib/api-auth';
import { EditLockUnavailableError, toPublicLockView, type EditingLock, type LockActor } from './edit-lock-types';
import { resolveLockActor, sanitizeClientInstanceId } from './resolve-lock-actor';
import { logEditLockAudit } from './edit-lock-audit';
import { assertActorHoldsEditLock, requestEditLock } from './edit-lock-service';

export async function authorizeEditLockCall(
    req: NextRequest,
    fileId: string,
    token: string | null | undefined,
    action: 'view' | 'edit',
    clientInstanceIdRaw?: unknown,
): Promise<
    | { errorResponse: NextResponse }
    | {
        actor: LockActor;
        linkId: string;
        fileId: string;
        token: string;
        sessionId: string;
        level: number;
        isOwner: boolean;
        effectiveEmail: string | null;
        fileVersion: number;
    }
> {
    if (!token) {
        return { errorResponse: NextResponse.json({ error: 'Missing token' }, { status: 400 }) };
    }

    const auth = await authorizeApiRequest(fileId, token, { httpMethod: req.method, action });
    if (auth.errorResponse) return { errorResponse: auth.errorResponse };

    const headerInstance = req.headers.get('x-edit-client-instance');
    const clientInstanceId = sanitizeClientInstanceId(
        clientInstanceIdRaw || headerInstance,
        auth.sessionId,
    );

    const actor = resolveLockActor({
        sessionId: auth.sessionId,
        effectiveEmail: auth.effectiveEmail,
        level: auth.level,
        isOwner: auth.isOwner,
        token: auth.secureLink.token,
        ownerId: auth.secureLink.ownerId,
        vendors: auth.secureLink.VendorAccess,
        clientInstanceId,
    });

    if (!actor) {
        return { errorResponse: NextResponse.json({ error: 'Forbidden: Identity required' }, { status: 403 }) };
    }

    return {
        actor,
        linkId: auth.secureLink.id,
        fileId: auth.file.id,
        token: auth.secureLink.token,
        sessionId: auth.sessionId,
        level: actor.priority,
        isOwner: auth.isOwner,
        effectiveEmail: auth.effectiveEmail,
        fileVersion: auth.file.version,
    };
}

export function lockUnavailableResponse(linkId: string | null, documentId: string, actor?: LockActor) {
    void logEditLockAudit('EDIT_LOCK_UNAVAILABLE', linkId, {
        actorUserId: actor?.userId,
        documentId,
        sessionId: actor?.sessionId,
        reason: 'REDIS_UNAVAILABLE',
    });
    return NextResponse.json(
        { error: 'Editing lock service unavailable. Try again shortly.' },
        { status: 503 },
    );
}

export function isUnavailable(err: unknown): boolean {
    return err instanceof EditLockUnavailableError;
}

/** Enforce Redis edit lock after authorizeApiRequest for document mutations. */
export async function requireHeldEditLock(
    auth: {
        file: { id: string };
        secureLink: { id: string; token: string; ownerId: string | null; VendorAccess: Array<{ id?: string; email: string; level?: number }> };
        sessionId: string;
        effectiveEmail: string | null;
        level: number;
        isOwner: boolean;
    },
    clientInstanceId?: unknown,
): Promise<{ actor: LockActor } | { errorResponse: NextResponse }> {
    const actor = resolveLockActor({
        sessionId: auth.sessionId,
        effectiveEmail: auth.effectiveEmail,
        level: auth.level,
        isOwner: auth.isOwner,
        token: auth.secureLink.token,
        ownerId: auth.secureLink.ownerId,
        vendors: auth.secureLink.VendorAccess,
        clientInstanceId,
    });
    if (!actor) {
        return { errorResponse: NextResponse.json({ error: 'Forbidden: Identity required' }, { status: 403 }) };
    }

    let check = await assertActorHoldsEditLock({ documentId: auth.file.id, actor });
    if (!check.ok && (check.reason === 'no_lock' || check.reason === 'lock_expired')) {
        try {
            const acquired = await requestEditLock({
                documentId: auth.file.id,
                linkId: auth.secureLink.id,
                actor,
            });
            if (acquired.status === 'acquired' || acquired.status === 'already_holder') {
                check = { ok: true, lock: acquired.lock };
            }
        } catch (err) {
            if (err instanceof EditLockUnavailableError) {
                return { errorResponse: lockUnavailableResponse(auth.secureLink.id, auth.file.id, actor) };
            }
            throw err;
        }
    }

    if (!check.ok) {
        await logEditLockAudit('STALE_SESSION_WRITE_DENIED', auth.secureLink.id, {
            actorUserId: actor.userId,
            targetUserId: check.lock?.userId,
            documentId: auth.file.id,
            teamId: actor.teamId,
            previousPriority: check.lock?.priority,
            requesterPriority: actor.priority,
            sessionId: actor.sessionId,
            reason: check.reason,
        });
        const status = check.reason === 'lock_unavailable' ? 503 : 409;
        const error =
            check.reason === 'not_holder'
                ? 'Your editing session is no longer active. A higher-priority collaborator may have taken control.'
                : check.reason === 'lock_unavailable'
                    ? 'Editing lock service unavailable. Try again shortly.'
                    : 'You do not hold the editing lock for this document.';
        return { errorResponse: NextResponse.json({ error, reason: check.reason }, { status }) };
    }

    return { actor };
}

export function lockPayload(lock: EditingLock | null, actor: LockActor, now = Date.now()) {
    const view = toPublicLockView(lock, now);
    return {
        lock: view,
        myPriority: actor.priority,
        myUserId: actor.userId,
        mySessionId: actor.sessionId,
        isHolder: Boolean(lock && lock.userId === actor.userId && lock.sessionId === actor.sessionId),
        isPendingRequester: Boolean(
            lock?.pendingTakeover
            && lock.pendingTakeover.requesterUserId === actor.userId,
        ),
        generation: lock?.generation ?? 0,
    };
}
