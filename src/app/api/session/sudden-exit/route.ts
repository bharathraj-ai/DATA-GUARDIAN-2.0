import { NextRequest, NextResponse } from 'next/server';
import { validateCSRF } from '@/lib/security/csrf';
import { suddenBrowserExit } from '@/lib/sudden-exit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/session/sudden-exit
 *
 * Beacon/keepalive target for sudden tab/browser close.
 * Auth: same-origin cookies + CSRF Origin/Referer (no nonce headers — sendBeacon cannot set them).
 * Body: { token, fileId?, clientInstanceId?, lastSavedWork?, resumePoint?, draftVersion? }
 */
export async function POST(req: NextRequest) {
    const csrf = validateCSRF(req);
    if (!csrf.allowed) {
        return NextResponse.json({ error: csrf.reason }, { status: csrf.status });
    }

    let body: {
        token?: string;
        fileId?: string;
        clientInstanceId?: string;
        lastSavedWork?: unknown;
        resumePoint?: unknown;
        currentPage?: number;
        draftVersion?: number;
    } = {};

    try {
        const text = await req.text();
        body = text ? (JSON.parse(text) as typeof body) : {};
    } catch {
        return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
    }

    const token = typeof body.token === 'string' ? body.token.trim() : '';
    if (!token) {
        return NextResponse.json({ error: 'Missing token' }, { status: 400 });
    }

    const result = await suddenBrowserExit(token, {
        fileId: typeof body.fileId === 'string' ? body.fileId : undefined,
        clientInstanceId:
            typeof body.clientInstanceId === 'string' ? body.clientInstanceId : undefined,
        lastSavedWork: body.lastSavedWork,
        resumePoint: body.resumePoint,
        currentPage: typeof body.currentPage === 'number' ? body.currentPage : undefined,
        draftVersion: typeof body.draftVersion === 'number' ? body.draftVersion : undefined,
    });

    if (!result.success) {
        const status = /unauthorized|invalid session|missing/i.test(result.error || '')
            ? 401
            : 500;
        return NextResponse.json(
            { error: status === 401 ? 'Unauthorized' : 'Sudden exit failed' },
            { status },
        );
    }

    return NextResponse.json({
        success: true,
        otpRotated: Boolean(result.otpRotated),
        lockReleased: Boolean(result.lockReleased),
    });
}
