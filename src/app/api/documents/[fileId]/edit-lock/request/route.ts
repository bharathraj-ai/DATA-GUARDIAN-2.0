import { NextRequest, NextResponse } from 'next/server';
import { authorizeEditLockCall, isUnavailable, lockPayload, lockUnavailableResponse } from '@/lib/collaboration/edit-lock-http';
import { auditLockRequestOutcome, requestEditLock } from '@/lib/collaboration/edit-lock-service';
import { getEditLockConfig } from '@/lib/collaboration/edit-lock-config';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/documents/[fileId]/edit-lock/request
 * Body: { token, clientInstanceId? }
 *
 * Priority is derived server-side from VendorAccess.level (or owner → 1).
 * Client-supplied priority is ignored.
 */
export async function POST(
    req: NextRequest,
    { params }: { params: Promise<{ fileId: string }> },
) {
    const { fileId } = await params;
    let body: { token?: string; clientInstanceId?: string; priority?: unknown } = {};
    try {
        body = await req.json();
    } catch {
        return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
    }

    const gate = await authorizeEditLockCall(req, fileId, body.token, 'edit', body.clientInstanceId);
    if ('errorResponse' in gate) return gate.errorResponse;

    const config = getEditLockConfig();

    try {
        const outcome = await requestEditLock({
            documentId: gate.fileId,
            linkId: gate.linkId,
            actor: gate.actor,
            config,
        });
        await auditLockRequestOutcome(outcome, gate.linkId, gate.actor, gate.fileId);

        const now = Date.now();
        const base = lockPayload('lock' in outcome ? outcome.lock : null, gate.actor, now);

        if (outcome.status === 'acquired' || outcome.status === 'already_holder') {
            return NextResponse.json({
                success: true,
                status: outcome.status,
                ...base,
                fileVersion: gate.fileVersion,
            });
        }

        if (outcome.status === 'takeover_pending') {
            const mode = outcome.lock.pendingTakeover?.mode || 'takeover';
            return NextResponse.json({
                success: true,
                status: 'takeover_pending',
                ...base,
                event: outcome.event,
                message: mode === 'request'
                    ? `${outcome.lock.userName} is editing (priority ${outcome.lock.priority}). They were notified. You can chat or wait to be allowed in.`
                    : `Higher-priority access requested. Waiting on current editor (${outcome.lock.userName}, priority ${outcome.lock.priority}).`,
                fileVersion: gate.fileVersion,
            });
        }

        if (outcome.status === 'duplicate_tab') {
            return NextResponse.json({
                success: false,
                status: 'duplicate_tab',
                ...base,
                error: 'You are already editing this document in another tab.',
                fileVersion: gate.fileVersion,
            }, { status: 409 });
        }

        if (outcome.status === 'denied_higher_priority') {
            return NextResponse.json({
                success: false,
                status: 'denied_higher_priority',
                ...base,
                error: `Document currently controlled by a higher-priority user.\n\nCurrent editor: ${outcome.lock.userName}\nPriority: ${outcome.lock.priority}\nYour priority: ${gate.actor.priority}`,
                fileVersion: gate.fileVersion,
            }, { status: 409 });
        }

        if (outcome.status === 'denied_no_access') {
            return NextResponse.json({
                success: false,
                status: 'denied_no_access',
                error: outcome.error,
            }, { status: 403 });
        }

        return NextResponse.json({
            success: false,
            status: 'denied_same_priority',
            ...base,
            error: `Document is currently being edited by ${outcome.lock.userName}.`,
            fileVersion: gate.fileVersion,
        }, { status: 409 });
    } catch (err) {
        if (isUnavailable(err)) return lockUnavailableResponse(gate.linkId, gate.fileId, gate.actor);
        console.error('[edit-lock/request]', err);
        return NextResponse.json({ error: 'Failed to request editing lock' }, { status: 500 });
    }
}
