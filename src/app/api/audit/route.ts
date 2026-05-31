import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { cookies } from 'next/headers';

/**
 * POST /api/audit
 * Receives client-side security events from SecurityShield.
 * Fire-and-forget from the client — failures here must never break UX.
 */

function sanitizeAuditMetadata(metadata: any) {
    if (!metadata || typeof metadata !== 'object') return {};
    
    const allowed = ['screenWidth', 'screenHeight', 'visibility', 'page', 'browser'];
    const sanitized: Record<string, any> = {};
    
    for (const key of allowed) {
        if (key in metadata) {
            sanitized[key] = metadata[key];
        }
    }
    
    return sanitized;
}

export async function POST(request: NextRequest) {
    try {
        const body = await request.json();
        const { token, action, timestamp, metadata } = body;

        if (!token || !action) {
            return NextResponse.json({ error: 'Missing fields' }, { status: 400 });
        }

        // SECURITY: Require active session to prevent audit log pollution
        const cookieStore = await cookies();
        const sessionId = cookieStore.get('session_id')?.value;
        if (!sessionId) {
            return NextResponse.json({ ok: true }); // Silent fail to not leak info
        }

        // Find the secure link to get the linkId
        const secureLink = await prisma.secureLink.findUnique({
            where: { token },
            select: { id: true, isRevoked: true },
        });

        if (!secureLink) {
            return NextResponse.json({ error: 'Invalid token' }, { status: 404 });
        }

        // Get client IP for audit trail
        const forwardedFor = request.headers.get('x-forwarded-for');
        const clientIp = forwardedFor?.split(',')[0]?.trim() || 'unknown';

        // sessionId already obtained from auth check above

        const sanitizedMetadata = sanitizeAuditMetadata(metadata);

        await prisma.auditLog.create({
            data: {
                action: `CLIENT_${action}`,
                linkId: secureLink.id,
                reason: `Client security event: ${action}`,
                metadata: JSON.stringify({
                    ...sanitizedMetadata,
                    clientTimestamp: timestamp,
                    clientIp,
                    sessionId: sessionId.substring(0, 8) + '...', // Truncate for safety
                    userAgent: request.headers.get('user-agent')?.substring(0, 100),
                }),
            },
        });

        return NextResponse.json({ ok: true });
    } catch (error) {
        console.error('[AUDIT] Client event logging error:', error instanceof Error ? error.message : 'Unknown');
        // Always return 200 to prevent client retries flooding the server
        return NextResponse.json({ ok: true });
    }
}
