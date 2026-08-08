import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { tryCheckRevoked, tryValidateSession } from '@/lib/redis-helpers';
import { verifyShareSession } from '@/lib/share-session';

export const dynamic = 'force-dynamic';

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
        // Optional Redis revoke cache
        const revokedInRedis = await tryCheckRevoked(token);
        if (revokedInRedis === true) {
            return NextResponse.json({ type: 'revoked' }, { status: 403 });
        }

        // Optional Redis session cache
        const sessionValid = await tryValidateSession(token, sessionId);
        if (sessionValid === false) {
            return NextResponse.json({ type: 'session_invalid' }, { status: 401 });
        }

        // Authoritative DB checks
        const link = await prisma.secureLink.findUnique({
            where: { token },
            select: { id: true, isRevoked: true, expiresAt: true },
        });

        if (!link || link.isRevoked) {
            return NextResponse.json({ type: 'revoked' }, { status: 403 });
        }

        if (link.expiresAt < new Date()) {
            return NextResponse.json({ type: 'expired' }, { status: 410 });
        }

        return NextResponse.json({ type: 'active' }, { status: 200 });
    } catch {
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
    }
}
