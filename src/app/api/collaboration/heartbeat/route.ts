// src/app/api/collaboration/heartbeat/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { extractClientIP, checkGlobalRateLimit } from '@/lib/rate-limit';
import { cookies } from 'next/headers';

export async function POST(req: NextRequest) {
    try {
        const ip = extractClientIP(req.headers);
        const rl = await checkGlobalRateLimit(ip);
        if (!rl.allowed) {
            return NextResponse.json({ error: 'Too many requests' }, { status: 429 });
        }

        // SECURITY: Require active session — prevent anonymous impersonation
        const cookieStore = await cookies();
        const sessionId = cookieStore.get('session_id')?.value;
        if (!sessionId) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const body = await req.json();
        const { token, vendorEmail, level, displayName } = body;

        if (!token || !vendorEmail || level === undefined) {
            return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
        }

        const link = await prisma.secureLink.findUnique({
            where: { token },
            select: { id: true, isRevoked: true, expiresAt: true },
        });
        if (!link || link.isRevoked || link.expiresAt < new Date()) {
            return NextResponse.json({ error: 'Invalid token' }, { status: 403 });
        }

        const docSessionId = `${token}_${Buffer.from(String(vendorEmail)).toString('base64').substring(0, 20)}`;

        await prisma.documentSession.upsert({
            where: { id: docSessionId },
            update: {
                lastSeenAt: new Date(),
                level: Number(level),
                displayName: displayName || String(vendorEmail).split('@')[0],
            },
            create: {
                id: docSessionId,
                token,
                fileId: 'N/A',
                userId: String(vendorEmail),
                level: Number(level),
                displayName: displayName || String(vendorEmail).split('@')[0],
                lastSeenAt: new Date(),
            }
        });

        return NextResponse.json({ success: true });
    } catch (error) {
        console.error('Heartbeat Error:', error);
        return NextResponse.json({ error: 'Failed to update heartbeat' }, { status: 500 });
    }
}
