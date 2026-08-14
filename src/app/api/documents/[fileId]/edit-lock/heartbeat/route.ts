import { NextRequest, NextResponse } from 'next/server';
import { authorizeEditLockCall, isUnavailable, lockPayload, lockUnavailableResponse } from '@/lib/collaboration/edit-lock-http';
import { completePriorityTakeover, heartbeatEditLock } from '@/lib/collaboration/edit-lock-service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/documents/[fileId]/edit-lock/heartbeat
 * Body: { token, clientInstanceId? }
 *
 * Holder refreshes TTL. Pending requester may complete takeover if grace expired.
 */
export async function POST(
    req: NextRequest,
    { params }: { params: Promise<{ fileId: string }> },
) {
    const { fileId } = await params;
    let body: { token?: string; clientInstanceId?: string } = {};
    try {
        body = await req.json();
    } catch {
        return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
    }

    const gate = await authorizeEditLockCall(req, fileId, body.token, 'edit', body.clientInstanceId);
    if ('errorResponse' in gate) return gate.errorResponse;

    try {
        const beat = await heartbeatEditLock({
            documentId: gate.fileId,
            actor: gate.actor,
        });

        let takeover = null as Awaited<ReturnType<typeof completePriorityTakeover>> | null;
        if (!beat.ok && beat.lock?.pendingTakeover) {
            const pending = beat.lock.pendingTakeover;
            const isRequester = pending.requesterUserId === gate.actor.userId;
            if (
                isRequester
                && (pending.mode || 'takeover') !== 'request'
                && pending.graceEndsAt > 0
                && Date.now() >= pending.graceEndsAt
            ) {
                takeover = await completePriorityTakeover({
                    documentId: gate.fileId,
                    linkId: gate.linkId,
                    actor: gate.actor,
                });
            }
        }

        const lock = takeover?.ok ? takeover.lock : beat.lock;
        return NextResponse.json({
            success: beat.ok || Boolean(takeover?.ok),
            status: takeover?.ok ? 'takeover_completed' : beat.ok ? 'ok' : beat.reason,
            ...lockPayload(lock, gate.actor),
            takeover: takeover?.ok
                ? { versionId: takeover.snapshot?.versionId, generation: takeover.lock?.generation }
                : null,
            fileVersion: gate.fileVersion,
        });
    } catch (err) {
        if (isUnavailable(err)) return lockUnavailableResponse(gate.linkId, gate.fileId, gate.actor);
        console.error('[edit-lock/heartbeat]', err);
        return NextResponse.json({ error: 'Failed to heartbeat editing lock' }, { status: 500 });
    }
}
