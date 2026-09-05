import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { decryptData } from '@/lib/crypto';
import { executeSingleLinkCleanup } from '@/lib/cleanup-core';
import { auth } from '@/lib/auth';
import { logger } from '@/lib/logger';

export const dynamic = 'force-dynamic'; // Prevent static generation during build
export const maxDuration = 60;

interface DecryptedUserData {
    firstName: string;
    lastName: string;
    email: string;
    phone: string;
    gender: string;
    age: number;
}

import { trySseAccessCheck, tryGetSessionTTL } from '@/lib/redis-helpers';
import { verifyShareSession } from '@/lib/share-session';
import { SSE_POLL_MS } from '@/lib/sse-poll';

/**
 * SSE endpoint for streaming decrypted data.
 * Auth: signed session cookie + Postgres. Redis is optional cache.
 */
export async function GET(
    request: NextRequest,
    { params }: { params: Promise<{ token: string }> }
) {
    const { token } = await params;

    const sessionCookie = request.cookies.get('session_id')?.value;
    const verified = verifyShareSession(sessionCookie, token);
    if (!verified.valid) {
        return new Response('Unauthorized: No session', { status: 401 });
    }
    const sessionId = verified.sessionId;

    const sseAccess = await trySseAccessCheck(token, sessionId);
    if (sseAccess === 'revoked') {
        return new Response('Access revoked', { status: 403 });
    }
    if (sseAccess === 'invalid') {
        return new Response('Session invalid or expired', { status: 401 });
    }

    // Get secure link and encrypted data
    const secureLink = await prisma.secureLink.findUnique({
        where: { token },
        select: {
            id: true,
            token: true,
            expiresAt: true,
            isUsed: true,
            isRevoked: true,
            UserData: { select: { encryptedData: true } },
            LinkAccess: {
                select: {
                    vendorEmail: true,
                    isUsed: true
                }
            },
            VendorAccess: {
                select: {
                    email: true,
                    level: true,
                },
            },
            UserFile: {
                select: { id: true },
            },
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
    // SEC-3: vendor identity from signed session first; encrypted cookie only (no plaintext)
    const rawVendorEmailCookie = request.cookies.get('vendor_email')?.value;
    let vendorEmail: string | undefined = verified.vendorEmail || undefined;
    if (!vendorEmail && rawVendorEmailCookie) {
        try {
            const decoded = decryptData<{ email: string }>(rawVendorEmailCookie);
            vendorEmail = decoded.email;
        } catch {
            vendorEmail = undefined;
        }
    }
    if (vendorEmail && secureLink.VendorAccess) {
        const vendor = secureLink.VendorAccess.find(v => v.email === vendorEmail!.toLowerCase());
        if (vendor) userLevel = vendor.level;
    }

    const now = new Date();
    if (secureLink.expiresAt < now) {
        // AUTO-CLEANUP: Delete all data immediately on expiry detection
        executeSingleLinkCleanup(token).catch(() => { });
        return new Response('Expired', { status: 410 });
    }

    // Decrypt data — mask PII for SSE (full unmasked only via authenticated actions that need it)
    let userData: DecryptedUserData;
    try {
        userData = decryptData<DecryptedUserData>(secureLink.UserData.encryptedData);
    } catch {
        return new Response('Decryption failed', { status: 500 });
    }

    const { maskEmail, maskPhone } = await import('@/lib/masking');
    const maskedUserData = {
        firstName: userData.firstName,
        lastName: userData.lastName,
        email: maskEmail(userData.email),
        phone: maskPhone(userData.phone),
        gender: userData.gender,
        age: userData.age,
    };

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
                userData: maskedUserData,
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
            let lastChatTimestamp: Date | null = null;
            let heartbeatTick = 0;
            let cachedExpiresAt = secureLink.expiresAt;
            let cachedLinkId = secureLink.id;
            const fileIds = (secureLink as { UserFile?: { id: string }[] }).UserFile?.map((f) => f.id) ?? [];
            let lastEditLockEventId: string | null = null;

            // Deterministic id so reconnects upsert instead of duplicating rows
            try {
                const presenceId = `sse:${sessionId}`.slice(0, 191);
                await prisma.documentSession.upsert({
                    where: { id: presenceId },
                    create: {
                        id: presenceId,
                        fileId: sessionId,
                        token,
                        level: userLevel,
                        lastSeenAt: new Date(),
                    },
                    update: {
                        lastSeenAt: new Date(),
                        level: userLevel,
                    },
                });
            } catch (e) {
                logger.error("Failed to upsert presence session:", e);
            }

            const logSessionEnd = async (reason: string) => {
                try {
                    // Remove presence session
                    await prisma.documentSession.deleteMany({
                        where: { fileId: sessionId, token: token }
                    });

                    const duration = Math.floor((Date.now() - startTime) / 1000);

                    // Kill-switch / cleanup often deletes SecureLink before this runs.
                    // For those reasons, never attach linkId (avoids noisy FK races).
                    // Forensic trail is preserved via metadata.originalLinkId.
                    const linkMayBeGone =
                        reason === 'revoked' ||
                        reason === 'session_invalidated';

                    let linkId: string | null = null;
                    if (!linkMayBeGone) {
                        const linkExists = await prisma.secureLink.findUnique({
                            where: { id: secureLink.id },
                            select: { id: true },
                        });
                        linkId = linkExists ? secureLink.id : null;
                    }

                    const logData = {
                        action: 'SESSION_ENDED',
                        linkId,
                        reason: `Session ended: ${reason}`,
                        metadata: JSON.stringify({
                            durationSeconds: duration,
                            endReason: reason,
                            originalLinkId: secureLink.id,
                        }),
                    };

                    try {
                        await prisma.auditLog.create({ data: logData });
                    } catch (e) {
                        const { Prisma } = await import('@prisma/client');
                        const isFk =
                            e instanceof Prisma.PrismaClientKnownRequestError &&
                            e.code === 'P2003';
                        if (isFk && logData.linkId) {
                            logger.warn(
                                'SESSION_ENDED: link deleted concurrently; logging with linkId=null',
                            );
                            await prisma.auditLog.create({
                                data: { ...logData, linkId: null },
                            });
                        } else {
                            logger.error('Failed to log session end:', e);
                        }
                    }
                } catch (e) {
                    logger.error('Failed to execute logSessionEnd block:', e);
                }
            };

            // Heartbeat: Redis every SSE_POLL_MS (kill-switch). Postgres every 5 ticks
            // so the stream does not exhaust the Neon pool during OTP / page loads.
            const heartbeatInterval = setInterval(async () => {
                if (isStreamClosed) {
                    clearInterval(heartbeatInterval);
                    return;
                }

                try {
                    const sseAccess = await trySseAccessCheck(token, sessionId);
                    if (sseAccess === 'revoked') {
                        safeEnqueue(encoder.encode(`data: ${JSON.stringify({ type: 'revoked' })}\n\n`));
                        clearInterval(heartbeatInterval);
                        safeClose();
                        await logSessionEnd('revoked');
                        return;
                    }
                    if (sseAccess === 'invalid') {
                        safeEnqueue(encoder.encode(`data: ${JSON.stringify({ type: 'session_invalid' })}\n\n`));
                        clearInterval(heartbeatInterval);
                        safeClose();
                        await logSessionEnd('session_invalidated');
                        return;
                    }
                    heartbeatTick += 1;
                    const mustReconcileDb = heartbeatTick === 1 || heartbeatTick % 5 === 0;
                    let link: { id: string; isRevoked: boolean; expiresAt: Date } | null = {
                        id: cachedLinkId,
                        isRevoked: false,
                        expiresAt: cachedExpiresAt,
                    };
                    if (mustReconcileDb) {
                        link = await prisma.secureLink.findUnique({
                            where: { token },
                            select: { id: true, isRevoked: true, expiresAt: true },
                        });
                        if (link) {
                            cachedLinkId = link.id;
                            cachedExpiresAt = link.expiresAt;
                        }
                    }

                    if (!link || link.isRevoked) {
                        safeEnqueue(encoder.encode(`data: ${JSON.stringify({ type: 'revoked' })}\n\n`));
                        clearInterval(heartbeatInterval);
                        safeClose();
                        await logSessionEnd('revoked');
                        executeSingleLinkCleanup(token).catch(() => { });
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
                        executeSingleLinkCleanup(token).catch(() => { });
                        return;
                    }

                    // Edit-lock events every tick so priority takeover appears without a page refresh.
                    let editLocks: Record<string, unknown> | undefined;
                    try {
                        const { getEditLockEvent, getEditLockStatuses } = await import('@/lib/collaboration/edit-lock-service');
                        const latestEvent = await getEditLockEvent(token);
                        if (latestEvent && latestEvent.id !== lastEditLockEventId) {
                            lastEditLockEventId = latestEvent.id;
                            safeEnqueue(encoder.encode(`data: ${JSON.stringify(latestEvent)}\n\n`));
                        }
                        if (fileIds.length > 0 && (heartbeatTick % 2 === 0 || Boolean(latestEvent?.type))) {
                            editLocks = await getEditLockStatuses(fileIds);
                        }
                    } catch {
                        // Lock bus is optional for the kill-switch heartbeat.
                    }

                    if (!mustReconcileDb) {
                        safeEnqueue(encoder.encode(`data: ${JSON.stringify({
                            type: 'heartbeat',
                            remainingSeconds: Math.min(ttl, dbRemainingSeconds),
                            myLevel: userLevel,
                            editLocks,
                            timestamp: Date.now(),
                        })}\n\n`));
                        return;
                    }

                    const threshold = new Date(Date.now() - 60_000);
                    const chatWhere = {
                        secureLinkId: link.id,
                        ...(lastChatTimestamp ? { timestamp: { gt: lastChatTimestamp } } : {}),
                        OR: vendorEmail
                            ? [
                                { receiverEmail: null },
                                { senderEmail: vendorEmail },
                                { receiverEmail: vendorEmail },
                              ]
                            : userEmail
                              ? [
                                  { receiverEmail: null },
                                  { senderEmail: userEmail },
                                  { receiverEmail: userEmail },
                                ]
                              : [{ receiverEmail: null }],
                    } as const;

                    const [activeSessions, recentChats, latestEditLog] = await Promise.all([
                        prisma.documentSession.findMany({
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
                        }),
                        prisma.chatMessage.findMany({
                            where: chatWhere,
                            orderBy: { timestamp: 'asc' },
                            take: lastChatTimestamp ? 50 : 100,
                            select: {
                                id: true,
                                senderEmail: true,
                                receiverEmail: true,
                                content: true,
                                timestamp: true,
                            },
                        }),
                        heartbeatTick === 1 || heartbeatTick % 5 === 0
                            ? prisma.auditLog.findFirst({
                                where: { linkId: link.id, action: 'VENDOR_EDITED_FILE' },
                                orderBy: { timestamp: 'desc' },
                                select: { timestamp: true }
                            })
                            : Promise.resolve(null),
                    ]);

                    let highestAuthorityLevel = userLevel;
                    if (activeSessions.length > 0) {
                        highestAuthorityLevel = Math.min(...activeSessions.map(s => s.level));
                    }

                    let highestActiveLevel = 99;
                    activeSessions.forEach(session => {
                        if (session.level < highestActiveLevel) highestActiveLevel = session.level;
                    });

                    if (recentChats.length > 0) {
                        lastChatTimestamp = recentChats[recentChats.length - 1].timestamp;
                    }

                    // Send heartbeat with countdown, presence, chat, and latest edit info
                    const heartbeat = {
                        type: 'heartbeat',
                        remainingSeconds: Math.min(ttl, dbRemainingSeconds),
                        myLevel: userLevel,
                        activeParticipants: activeSessions.map((s) => ({
                            email: s.userId,
                            name: s.displayName,
                            level: s.level,
                            color: s.color,
                        })),
                        highestActiveLevel: highestActiveLevel === 99 ? undefined : highestActiveLevel,
                        highestAuthorityLevel,
                        chats: recentChats,
                        latestFileInputTimestamp: latestEditLog?.timestamp?.getTime(),
                        editLocks,
                        timestamp: Date.now(),
                    };
                    safeEnqueue(encoder.encode(`data: ${JSON.stringify(heartbeat)}\n\n`));
                } catch (error) {
                    logger.error('Heartbeat error:', error instanceof Error ? error.message : 'Unknown');
                    clearInterval(heartbeatInterval);
                    safeClose();
                    await logSessionEnd('error');
                }
            }, SSE_POLL_MS);

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
