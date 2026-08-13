import { NextRequest, NextResponse } from 'next/server';
import { authorizeEditLockCall, isUnavailable, lockPayload, lockUnavailableResponse } from '@/lib/collaboration/edit-lock-http';
import { acceptPriorityTakeover, completePriorityTakeover } from '@/lib/collaboration/edit-lock-service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/documents/[fileId]/edit-lock/takeover
 * Body: { token, clientInstanceId?, action?: 'complete' | 'accept' | 'force' }
 *
 * accept  → current editor allows the requester in
 * force   → higher-priority requester takes over immediately (no countdown)
 * complete → after accept, or after optional timed grace if configured
 */
export async function POST(
    req: NextRequest,
    { params }: { params: Promise<{ fileId: string }> },
) {
    const { fileId } = await params;
    let body: { token?: string; clientInstanceId?: string; action?: string } = {};
    try {
        body = await req.json();
    } catch {
        return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
    }

    const gate = await authorizeEditLockCall(req, fileId, body.token, 'edit', body.clientInstanceId);
    if ('errorResponse' in gate) return gate.errorResponse;

    const action = body.action === 'accept' ? 'accept' : body.action === 'force' ? 'force' : 'complete';

    try {
        if (action === 'accept') {
            const accepted = await acceptPriorityTakeover({
                documentId: gate.fileId,
                linkId: gate.linkId,
                actor: gate.actor,
            });
            return NextResponse.json({
                success: accepted.ok,
                status: accepted.ok ? 'accepted' : accepted.reason,
                ...lockPayload(accepted.lock, gate.actor),
            }, { status: accepted.ok ? 200 : 409 });
        }

        const completed = await completePriorityTakeover({
            documentId: gate.fileId,
            linkId: gate.linkId,
            actor: gate.actor,
            forceAfterAccept: action !== 'force',
            forceImmediate: action === 'force',
        });

        if (!completed.ok) {
            const status = completed.reason === 'snapshot_failed' ? 500
                : completed.reason === 'too_early' ? 409
                    : completed.reason === 'missing' ? 404
                        : 409;
            return NextResponse.json({
                success: false,
                status: completed.reason,
                remainingMs: completed.remainingMs,
                error: completed.reason === 'snapshot_failed'
                    ? 'Auto-save before takeover failed. Takeover aborted to protect unsaved work.'
                    : completed.reason === 'too_early'
                        ? (completed.lock?.pendingTakeover?.mode === 'request'
                            ? 'Waiting for the current editor to Allow you in or chat.'
                            : 'Waiting for the current editor to Allow you in. Use Take over now to force access.')
                        : completed.reason === 'not_requester'
                            ? 'Only the pending requester can complete this access request.'
                            : 'Takeover could not be completed.',
                ...lockPayload(completed.lock, gate.actor),
            }, { status });
        }

        return NextResponse.json({
            success: true,
            status: 'takeover_completed',
            ...lockPayload(completed.lock, gate.actor),
            snapshot: {
                versionId: completed.snapshot?.versionId,
                versionNumber: completed.snapshot?.versionNumber,
                reason: 'PRIORITY_TAKEOVER',
                previousVersionId: completed.snapshot?.previousVersionId,
            },
            fileVersion: gate.fileVersion,
        });
    } catch (err) {
        if (isUnavailable(err)) return lockUnavailableResponse(gate.linkId, gate.fileId, gate.actor);
        console.error('[edit-lock/takeover]', err);
        return NextResponse.json({ error: 'Failed to process takeover' }, { status: 500 });
    }
}
