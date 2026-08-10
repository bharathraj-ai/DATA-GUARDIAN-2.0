import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { tryCheckRevoked, tryValidateSession } from '@/lib/redis-helpers';
import { verifyShareSession } from '@/lib/share-session';
import { generateDeviceHash } from '@/lib/fingerprint';
import { isSessionDeviceMismatch } from '@/lib/session-device';

export const dynamic = 'force-dynamic';

/**
 * Lightweight access re-check used when focus returns to a protected view.
 * Does not revoke the link — only reports whether content may be shown again.
 */
export async function GET(request: NextRequest) {
    const token = request.nextUrl.searchParams.get('token');
    if (!token) {
        return NextResponse.json({ error: 'Missing token' }, { status: 400 });
    }

    const sessionCookie = request.cookies.get('session_id')?.value;
    const verified = verifyShareSession(sessionCookie, token);
    if (!verified.valid) {
        return NextResponse.json({ type: 'session_invalid' }, { status: 401 });
    }
    const sessionId = verified.sessionId;

    try {
        const revokedInRedis = await tryCheckRevoked(token);
        if (revokedInRedis === true) {
            return NextResponse.json({ type: 'revoked' }, { status: 403 });
        }

        const sessionValid = await tryValidateSession(token, sessionId);
        if (sessionValid === false) {
            return NextResponse.json({ type: 'session_invalid' }, { status: 401 });
        }

        const link = await prisma.secureLink.findUnique({
            where: { token },
            select: {
                id: true,
                isRevoked: true,
                expiresAt: true,
                lockedAt: true,
                VendorAccess: {
                    where: { activeSessionId: sessionId },
                    select: { activeDeviceHash: true, isRevoked: true, status: true },
                    take: 1,
                },
            },
        });

        if (!link || link.isRevoked || link.lockedAt) {
            return NextResponse.json({ type: 'revoked' }, { status: 403 });
        }

        if (link.expiresAt < new Date()) {
            return NextResponse.json({ type: 'expired' }, { status: 410 });
        }

        const vendor = link.VendorAccess[0];
        if (vendor?.isRevoked || vendor?.status === 'completed') {
            return NextResponse.json({ type: 'revoked' }, { status: 403 });
        }

        if (vendor?.activeDeviceHash) {
            const currentHash = generateDeviceHash(request.headers);
            if (isSessionDeviceMismatch(vendor.activeDeviceHash, currentHash)) {
                return NextResponse.json({ type: 'session_invalid' }, { status: 401 });
            }
        }

        return NextResponse.json({ type: 'active' }, { status: 200 });
    } catch {
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
    }
}
