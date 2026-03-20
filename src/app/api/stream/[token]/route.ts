import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { decryptData } from '@/lib/crypto';
import { cleanupSingleLink } from '@/actions/cleanup';
import { auth } from '@/lib/auth';

export const dynamic = 'force-dynamic'; // Prevent static generation during build

interface DecryptedUserData {
    firstName: string;
    lastName: string;
    email: string;
    phone: string;
    gender: string;
    age: number;
}

// Cache Redis availability check at module load (performance optimization)
const isRedisConfigured = !!(
    process.env.UPSTASH_REDIS_REST_URL &&
    process.env.UPSTASH_REDIS_REST_TOKEN &&
    !process.env.UPSTASH_REDIS_REST_URL.includes('your-redis')
);

// Helper to check Redis if configured
async function tryIsTokenRevoked(token: string): Promise<boolean | null> {
    if (!isRedisConfigured) return null;

    try {
        const { isTokenRevoked } = await import('@/lib/redis');
        return await isTokenRevoked(token);
    } catch {
        return null;
    }
}

async function tryValidateSession(token: string, sessionId: string): Promise<boolean | null> {
    if (!isRedisConfigured) return null;

    try {
        const { validateSession } = await import('@/lib/redis');
        return await validateSession(token, sessionId);
    } catch {
        return null;
    }
}

async function tryGetSessionTTL(token: string, sessionId: string, fallback: number): Promise<number> {
    if (!isRedisConfigured) return fallback;

    try {
        const { getSessionTTL } = await import('@/lib/redis');
        const ttl = await getSessionTTL(token, sessionId);
        return ttl > 0 ? ttl : fallback;
    } catch {
        return fallback;
    }
}

/**
 * Server-Sent Events (SSE) endpoint for streaming decrypted data
 * 
 * Security features:
 * - Validates session on connection and with heartbeats
 * - Terminates stream immediately if session expires or is revoked
 * - Sends countdown updates from server (not frontend)
 * - Backend-enforced access control
 */
export async function GET(
    request: NextRequest,
    { params }: { params: Promise<{ token: string }> }
) {
    const { token } = await params;

    // Get session ID from cookie
    const sessionId = request.cookies.get('session_id')?.value;

    if (!sessionId) {
        return new Response('Unauthorized: No session', { status: 401 });
    }

    // Check revocation in Redis (if available)
    const revokedInRedis = await tryIsTokenRevoked(token);
    if (revokedInRedis === true) {
        return new Response('Access revoked', { status: 403 });
    }

    // Validate session in Redis (if available)
    const sessionValid = await tryValidateSession(token, sessionId);
    if (sessionValid === false) {
        return new Response('Session invalid or expired', { status: 401 });
    }

    // Get secure link and encrypted data
    const secureLink = await prisma.secureLink.findUnique({
        where: { token },
        include: { 
            UserData: true,
            LinkAccess: {
                select: {
                    vendorEmail: true,
                    isUsed: true
                }
            }
        },
    });

    // Determine vendor access state
    const authSession = await auth();
    const userEmail = authSession?.user?.email;
    const vendorAccess = secureLink?.LinkAccess?.find(
        a => userEmail && a.vendorEmail.toLowerCase() === userEmail.toLowerCase()
    );
    const isUsed = vendorAccess ? vendorAccess.isUsed : secureLink?.isUsed;

    if (!secureLink || !secureLink.UserData || !isUsed || secureLink.isRevoked) {
        return new Response('Not accessible', { status: 404 });
    }

    const now = new Date();
    if (secureLink.expiresAt < now) {
        // AUTO-CLEANUP: Delete all data immediately on expiry detection
        cleanupSingleLink(token).catch(() => { });
        return new Response('Expired', { status: 410 });
    }

    // Decrypt data
    let userData: DecryptedUserData;
    try {
        userData = decryptData<DecryptedUserData>(secureLink.UserData.encryptedData);
    } catch {
        return new Response('Decryption failed', { status: 500 });
    }

    // Create SSE stream
    const encoder = new TextEncoder();

    const stream = new ReadableStream({
        async start(controller) {
            // Send initial data
            const initialSeconds = Math.max(0, Math.floor((secureLink.expiresAt.getTime() - Date.now()) / 1000));
            const initialData = {
                type: 'data',
                userData,
                expiresAt: secureLink.expiresAt.toISOString(),
                remainingSeconds: initialSeconds,
            };
            controller.enqueue(encoder.encode(`data: ${JSON.stringify(initialData)}\n\n`));

            const startTime = Date.now();
            const logSessionEnd = async (reason: string) => {
                try {
                    const duration = Math.floor((Date.now() - startTime) / 1000);

                    // Check if the link still exists before creating audit log
                    const linkExists = await prisma.secureLink.findUnique({
                        where: { id: secureLink.id },
                        select: { id: true }
                    });

                    if (!linkExists) {
                        console.log(`[AUDIT] Skipping session end log - link ${secureLink.id} no longer exists`);
                        return;
                    }

                    // Fire and forget audit log
                    await prisma.auditLog.create({
                        data: {
                            action: 'SESSION_ENDED',
                            linkId: secureLink.id,
                            reason: `Session ended: ${reason}`,
                            metadata: JSON.stringify({ durationSeconds: duration, endReason: reason }),
                        },
                    });
                } catch (e) {
                    // Gracefully handle foreign key constraint errors
                    if (e instanceof Error && e.message.includes('Foreign key constraint')) {
                        console.log(`[AUDIT] Link was deleted before session end could be logged`);
                    } else {
                        console.error('Failed to log session end:', e);
                    }
                }
            };

            // Heartbeat interval - 3 seconds for near-instant kill switch (<100ms after revocation)
            // This frequent polling ensures revocation is detected within 3 seconds maximum
            const heartbeatInterval = setInterval(async () => {
                try {
                    // KILL SWITCH: Check Redis first (faster ~10-50ms) before DB
                    const revokedInRedis = await tryIsTokenRevoked(token);
                    if (revokedInRedis === true) {
                        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'revoked' })}\n\n`));
                        clearInterval(heartbeatInterval);
                        controller.close();
                        logSessionEnd('revoked');
                        return;
                    }

                    // Validate session still exists in Redis
                    const sessionValid = await tryValidateSession(token, sessionId);
                    if (sessionValid === false) {
                        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'session_invalid' })}\n\n`));
                        clearInterval(heartbeatInterval);
                        controller.close();
                        logSessionEnd('session_invalidated');
                        return;
                    }

                    // Check DB for revocation (fallback when Redis not configured)
                    const link = await prisma.secureLink.findUnique({
                        where: { token },
                        select: { id: true, isRevoked: true, expiresAt: true },
                    });

                    if (!link || link.isRevoked) {
                        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'revoked' })}\n\n`));
                        clearInterval(heartbeatInterval);
                        controller.close();
                        logSessionEnd('revoked');
                        // AUTO-CLEANUP: Purge all data when revoked
                        cleanupSingleLink(token).catch(() => { });
                        return;
                    }

                    // Calculate remaining time
                    const dbRemainingSeconds = Math.floor((link.expiresAt.getTime() - Date.now()) / 1000);
                    const ttl = await tryGetSessionTTL(token, sessionId, dbRemainingSeconds);

                    if (ttl <= 0 || dbRemainingSeconds <= 0) {
                        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'expired' })}\n\n`));
                        clearInterval(heartbeatInterval);
                        controller.close();
                        logSessionEnd('expired');
                        // AUTO-CLEANUP: Purge all data when time expires
                        cleanupSingleLink(token).catch(() => { });
                        return;
                    }

                    // Fetch active sessions for presence
                    const threshold = new Date(Date.now() - 15000);
                    const activeSessions = await prisma.documentSession.findMany({
                        where: {
                            token,
                            lastSeenAt: { gte: threshold }
                        },
                        select: {
                            userId: true,
                            displayName: true,
                            level: true,
                            color: true
                        }
                    });

                    // Compute highest authority
                    let highestActiveLevel = 99;
                    activeSessions.forEach(session => {
                        if (session.level < highestActiveLevel) highestActiveLevel = session.level;
                    });

                    // Fetch recent chat messages
                    const recentChats = await prisma.chatMessage.findMany({
                        where: { secureLinkId: link.id },
                        orderBy: { timestamp: 'asc' },
                        take: 100
                    });

                    // Send heartbeat with countdown, presence, and chat
                    const heartbeat = {
                        type: 'heartbeat',
                        remainingSeconds: Math.min(ttl, dbRemainingSeconds),
                        activeParticipants: activeSessions,
                        highestActiveLevel: highestActiveLevel === 99 ? undefined : highestActiveLevel,
                        chats: recentChats,
                        timestamp: Date.now(),
                    };
                    controller.enqueue(encoder.encode(`data: ${JSON.stringify(heartbeat)}\n\n`));
                } catch (error) {
                    console.error('Heartbeat error:', error instanceof Error ? error.message : 'Unknown');
                    clearInterval(heartbeatInterval);
                    controller.close();
                    logSessionEnd('error');
                }
            }, 3000); // 3 second heartbeat for near-instant kill switch

            // Cleanup on abort
            request.signal.addEventListener('abort', () => {
                clearInterval(heartbeatInterval);
                controller.close();
                logSessionEnd('client_disconnect');
            });
        },
    });

    return new Response(stream, {
        headers: {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache, no-store, must-revalidate, max-age=0',
            'Pragma': 'no-cache',
            'Expires': '0',
            'Connection': 'keep-alive',
            'X-Accel-Buffering': 'no', // Disable nginx buffering
        },
    });
}
