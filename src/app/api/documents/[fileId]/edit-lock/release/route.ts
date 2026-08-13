import { NextRequest, NextResponse } from 'next/server';
import { authorizeEditLockCall, isUnavailable, lockPayload, lockUnavailableResponse } from '@/lib/collaboration/edit-lock-http';
import { releaseEditLock } from '@/lib/collaboration/edit-lock-service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/documents/[fileId]/edit-lock/release
 * Body: { token, clientInstanceId? }
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
        const result = await releaseEditLock({
            documentId: gate.fileId,
            linkId: gate.linkId,
            actor: gate.actor,
        });
        return NextResponse.json({
            success: result.released,
            status: result.released ? (result.grantedTo ? 'granted_pending_requester' : 'released') : result.reason,
            ...lockPayload(result.grantedTo, gate.actor),
            grantedTo: result.grantedTo
                ? { userId: result.grantedTo.userId, userName: result.grantedTo.userName, priority: result.grantedTo.priority }
                : null,
        });
    } catch (err) {
        if (isUnavailable(err)) return lockUnavailableResponse(gate.linkId, gate.fileId, gate.actor);
        console.error('[edit-lock/release]', err);
        return NextResponse.json({ error: 'Failed to release editing lock' }, { status: 500 });
    }
}
