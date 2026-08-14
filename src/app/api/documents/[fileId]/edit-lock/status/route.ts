import { NextRequest, NextResponse } from 'next/server';
import { authorizeEditLockCall, isUnavailable, lockPayload, lockUnavailableResponse } from '@/lib/collaboration/edit-lock-http';
import { completePriorityTakeover, getEditLockStatus } from '@/lib/collaboration/edit-lock-service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/documents/[fileId]/edit-lock/status?token=
 *
 * Source of truth on reconnect / refresh. Never trust client lock state.
 */
export async function GET(
    req: NextRequest,
    { params }: { params: Promise<{ fileId: string }> },
) {
    const { fileId } = await params;
    const token = req.nextUrl.searchParams.get('token');
    const clientInstanceId = req.nextUrl.searchParams.get('clientInstanceId');

    const gate = await authorizeEditLockCall(req, fileId, token, 'view', clientInstanceId);
    if ('errorResponse' in gate) return gate.errorResponse;

    try {
        let { lock } = await getEditLockStatus(gate.fileId);
        let takeoverCompleted = false;
        let versionId: string | undefined;

        const pending = lock?.pendingTakeover;
        if (
            pending
            && pending.requesterUserId === gate.actor.userId
            && (pending.mode || 'takeover') !== 'request'
            && pending.graceEndsAt > 0
            && Date.now() >= pending.graceEndsAt
        ) {
            const completed = await completePriorityTakeover({
                documentId: gate.fileId,
                linkId: gate.linkId,
                actor: gate.actor,
            });
            if (completed.ok) {
                lock = completed.lock;
                takeoverCompleted = true;
                versionId = completed.snapshot?.versionId;
            }
        }

        return NextResponse.json({
            success: true,
            status: takeoverCompleted ? 'takeover_completed' : lock ? 'locked' : 'unlocked',
            ...lockPayload(lock, gate.actor),
            takeover: takeoverCompleted ? { versionId } : null,
            fileVersion: gate.fileVersion,
        });
    } catch (err) {
        if (isUnavailable(err)) return lockUnavailableResponse(gate.linkId, gate.fileId, gate.actor);
        console.error('[edit-lock/status]', err);
        return NextResponse.json({ error: 'Failed to read editing lock' }, { status: 500 });
    }
}
