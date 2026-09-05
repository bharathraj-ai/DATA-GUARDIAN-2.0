import { after } from 'next/server';
import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { verifyShareSession } from '@/lib/share-session';
import { extractClientIP, checkGlobalRateLimit } from '@/lib/rate-limit';
import {
    isAllowedSuspiciousReason,
    revokeForSuspiciousActivity,
} from '@/lib/revoke-suspicious-activity';
import { logger } from '@/lib/logger';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

function runAfterResponse(work: () => Promise<void>) {
    try {
        after(work);
    } catch {
        void work();
    }
}

/**
 * POST /api/security/suspicious-activity
 *
 * Vendor share-session only. On a confirmed screenshot/capture attempt,
 * revoke the share link, notify the owner, and purge shared data.
 */
export async function POST(request: NextRequest) {
    try {
        let body: { token?: unknown; reason?: unknown } = {};
        try {
            body = (await request.json()) as typeof body;
        } catch {
            return NextResponse.json({ ok: true });
        }

        const token = typeof body.token === 'string' ? body.token.trim() : '';
        if (!token || !isAllowedSuspiciousReason(body.reason)) {
            return NextResponse.json({ ok: true });
        }

        try {
            const ip = extractClientIP(request.headers);
            const rl = await checkGlobalRateLimit(ip);
            if (!rl.allowed) {
                logger.warn('[suspicious-revoke] rate-limited but still processing authenticated revoke');
            }
        } catch {
            /* rate-limit errors must not skip a kill-switch */
        }

        const cookieStore = await cookies();
        const verified = verifyShareSession(cookieStore.get('session_id')?.value, token);
        if (!verified.valid) {
            return NextResponse.json({ ok: true });
        }

        const result = await revokeForSuspiciousActivity({
            token,
            reason: body.reason,
            vendorEmail: verified.vendorEmail,
            sessionId: verified.sessionId,
        });

        if (result.notify || result.tokenToPurge) {
            const notify = result.notify;
            const tokenToPurge = result.tokenToPurge;
            if (notify) {
                void import('@/lib/notifications')
                    .then(({ notifySuspiciousActivity }) =>
                        notifySuspiciousActivity(
                            notify.email,
                            notify.linkId,
                            notify.vendorEmail,
                            notify.reason,
                            notify.forensicWatermark,
                        ),
                    )
                    .catch((err) => {
                        logger.error(
                            '[suspicious-revoke] owner notify failed',
                            err instanceof Error ? err.message : 'Unknown',
                        );
                    });
            }
            if (tokenToPurge) {
                runAfterResponse(async () => {
                    const { executeSingleLinkCleanup } = await import('@/lib/cleanup-core');
                    const cleanup = await executeSingleLinkCleanup(tokenToPurge);
                    if (!cleanup.success) {
                        logger.error(
                            `[suspicious-revoke] cleanup failed: ${cleanup.error || 'unknown'}`,
                        );
                    }
                });
            }
        }

        return NextResponse.json({ ok: true, revoked: result.success });
    } catch (err) {
        logger.error(
            '[suspicious-revoke] handler error',
            err instanceof Error ? err.message : 'Unknown',
        );
        return NextResponse.json({ ok: true });
    }
}
