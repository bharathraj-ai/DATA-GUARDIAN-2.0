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

import { tryCheckRevoked, tryValidateSession, tryGetSessionTTL } from '@/lib/redis-helpers';

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
    // null = Redis unavailable → fall through to DB check below
    const revokedInRedis = await tryCheckRevoked(token);
    if (revokedInRedis === true) {
        return new Response('Access revoked', { status: 403 });
    }

    // Validate session in Redis (if available)
    // null = Redis unavailable → fall through to DB-level auth
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
            },
            VendorAccess: true
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

    // Determine current user's level
    let userLevel = 2;
    const vendorEmail = request.cookies.get('vendor_email')?.value;
    if (vendorEmail && secureLink.VendorAccess) {
        const vendor = secureLink.VendorAccess.find(v => v.email === vendorEmail.toLowerCase());
        if (vendor) userLevel = vendor.level;
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
            let isStreamClosed = false;

            const safeClose = () => {
                if (isStreamClosed) return;
                isStreamClosed = true;
                try {
                    controller.close();
                } catch (e) {
                    // Ignore error if it's already closed
                }
            };

            const safeEnqueue = (data: Uint8Array) => {
                if (isStreamClosed) return;
                try {
                    controller.enqueue(data);
                } catch (e) {
                    isStreamClosed = true;
                    throw e;
                }
            };

            // Send initial data
            const initialSeconds = Math.max(0, Math.floor((secureLink.expiresAt.getTime() - Date.now()) / 1000));
            const initialData = {
                type: 'data',
                userData,
                expiresAt: secureLink.expiresAt.toISOString(),
                remainingSeconds: initialSeconds,
            };

            try {
                safeEnqueue(encoder.encode(`data: ${JSON.stringify(initialData)}\n\n`));
            } catch (e) {
                safeClose();
                return;
            }

            const startTime = Date.now();

            // Track active session presence
            try {
                await prisma.documentSession.create({
                    data: {
                        fileId: sessionId, // Use fileId to store sessionId for global presence
                        token: token,
                        level: userLevel
                    }
                });
            } catch (e) {
                console.error("Failed to create presence session:", e);
            }

            const logSessionEnd = async (reason: string) => {
                try {
                    // Remove presence session
                    await prisma.documentSession.deleteMany({
                        where: { fileId: sessionId, token: token }
                    });

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
                if (isStreamClosed) {
                    clearInterval(heartbeatInterval);
                    return;
                }

                try {
                    // KILL SWITCH: Check Redis first (faster ~10-50ms) before DB
                    const revokedInRedis = await tryCheckRevoked(token);
                    if (revokedInRedis === true) {
                        safeEnqueue(encoder.encode(`data: ${JSON.stringify({ type: 'revoked' })}\n\n`));
                        clearInterval(heartbeatInterval);
                        safeClose();
                        await logSessionEnd('revoked');
                        return;
                    }

                    // Validate session still exists in Redis
                    // null = Redis unavailable → skip, DB fallback below handles it
                    const sessionValid = await tryValidateSession(token, sessionId);
                    if (sessionValid === false) {
                        safeEnqueue(encoder.encode(`data: ${JSON.stringify({ type: 'session_invalid' })}\n\n`));
                        clearInterval(heartbeatInterval);
                        safeClose();
                        await logSessionEnd('session_invalidated');
                        return;
                    }
                    // Check DB for revocation (fallback when Redis not configured)
                    const link = await prisma.secureLink.findUnique({
                        where: { token },
                        select: { id: true, isRevoked: true, expiresAt: true },
                    });

                    if (!link || link.isRevoked) {
                        safeEnqueue(encoder.encode(`data: ${JSON.stringify({ type: 'revoked' })}\n\n`));
                        clearInterval(heartbeatInterval);
                        safeClose();
                        await logSessionEnd('revoked');
                        // AUTO-CLEANUP: Purge all data when revoked
                        cleanupSingleLink(token).catch(() => { });
                        return;
                    }

                    // Calculate remaining time
                    const dbRemainingSeconds = Math.floor((link.expiresAt.getTime() - Date.now()) / 1000);
                    const ttl = await tryGetSessionTTL(token, sessionId, dbRemainingSeconds);

                    if (ttl <= 0 || dbRemainingSeconds <= 0) {
                        safeEnqueue(encoder.encode(`data: ${JSON.stringify({ type: 'expired' })}\n\n`));
                        clearInterval(heartbeatInterval);
                        safeClose();
                        await logSessionEnd('expired');
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

                    let highestAuthorityLevel = userLevel;
                    if (activeSessions.length > 0) {
                        highestAuthorityLevel = Math.min(...activeSessions.map(s => s.level));
                    }

                    // Compute highest authority for UI
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

                    // Fetch latest file edit timestamp
                    const latestEditLog = await prisma.auditLog.findFirst({
                        where: { linkId: link.id, action: 'VENDOR_EDITED_FILE' },
                        orderBy: { timestamp: 'desc' },
                        select: { timestamp: true }
                    });

                    // Send heartbeat with countdown, presence, chat, and latest edit info
                    const heartbeat = {
                        type: 'heartbeat',
                        remainingSeconds: Math.min(ttl, dbRemainingSeconds),
                        activeParticipants: activeSessions,
                        highestActiveLevel: highestActiveLevel === 99 ? undefined : highestActiveLevel,
                        highestAuthorityLevel,
                        chats: recentChats,
                        latestFileInputTimestamp: latestEditLog?.timestamp?.getTime(),
                        timestamp: Date.now(),
                    };
                    safeEnqueue(encoder.encode(`data: ${JSON.stringify(heartbeat)}\n\n`));
                } catch (error) {
                    console.error('Heartbeat error:', error instanceof Error ? error.message : 'Unknown');
                    clearInterval(heartbeatInterval);
                    safeClose();
                    await logSessionEnd('error');
                }
            }, 3000); // 3 second heartbeat for near-instant kill switch

            // Cleanup on abort
            request.signal.addEventListener('abort', async () => {
                clearInterval(heartbeatInterval);
                safeClose();
                await logSessionEnd('client_disconnect');
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
