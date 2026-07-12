import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { tryCheckRevoked, tryValidateSession } from '@/lib/redis-helpers';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
    const token = request.nextUrl.searchParams.get('token');
    if (!token) {
        return NextResponse.json({ error: 'Missing token' }, { status: 400 });
    }

    const sessionId = request.cookies.get('session_id')?.value;
    if (!sessionId) {
        return NextResponse.json({ type: 'session_invalid' }, { status: 401 });
    }

    try {
        // 1. Check Redis for fast revocation flag
        const revokedInRedis = await tryCheckRevoked(token);
        if (revokedInRedis === true) {
            return NextResponse.json({ type: 'revoked' }, { status: 403 });
        }

        // 2. Validate Session in Redis
        const sessionValid = await tryValidateSession(token, sessionId);
        if (sessionValid === false) {
            return NextResponse.json({ type: 'session_invalid' }, { status: 401 });
        }

        // 3. Fallback: Check DB
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

        // Access is valid
        return NextResponse.json({ type: 'active' }, { status: 200 });
    } catch (error) {
        // On error, let client retry
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
    }
}
