import { NextRequest } from 'next/server';
import { cookies } from 'next/headers';
import { authorizeSecureLink } from '@/lib/linkAuthorization';
import { prisma } from '@/lib/prisma';
import { SSE_POLL_MS } from '@/lib/sse-poll';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * GET /api/session-monitor?token=
 *
 * Server-Sent Events endpoint.
 * Polls Redis every SSE_POLL_MS for link revocation flags.
 * If the link has been revoked, sends { type: "revoked" } and closes.
 * Also sends periodic heartbeats to keep the connection alive.
 * 
 * SECURITY: Requires active session cookie.
 */
export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get('token');

  // SECURITY: Require session cookie — prevent unauthenticated data leakage
  const cookieStore = await cookies();
  const sessionId = cookieStore.get('session_id')?.value;
  if (!sessionId) {
    return new Response('Unauthorized', { status: 401 });
  }

  if (!token) {
    return new Response('Missing token', { status: 400 });
  }

  const authResult = await authorizeSecureLink(token, 'view', undefined, { includeDraft: false });
  if (!authResult.success) {
    // Uniform deny — avoid token existence oracle via distinct audit side-channels in response
    return new Response('Forbidden', { status: 403 });
  }

  const viewerEmail = authResult.context.effectiveEmail;

  await prisma.auditLog.create({
    data: {
      action: 'SESSION_MONITOR_CONNECTED',
      linkId: authResult.context.secureLink.id,
      reason: 'User connected to SSE session monitor',
      metadata: JSON.stringify({
         email: viewerEmail || 'unknown'
      })
    }
  }).catch(() => {});

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      let closed = false;

      const send = (data: object) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
        } catch {
          closed = true;
        }
      };

      // Dynamic import to avoid edge-runtime issues
      const redis = (await import('@/lib/redis')).default;
      const prisma = (await import('@/lib/prisma')).prisma;

      // Initial check
      if (!token) {
        send({ type: 'error', message: 'Missing token' });
        controller.close();
        return;
      }

      let lastChatTimestamp: Date | null = null;
      let heartbeatTick = 0;
      let cachedLinkId = authResult.context.secureLink.id;
      let cachedExpiresAt = authResult.context.secureLink.expiresAt;

      const pollInterval = setInterval(async () => {
        if (closed) { clearInterval(pollInterval); return; }
        try {
          // Check Redis for revocation flag (set by revoke-access action)
          let redisRevoked = false;
          try {
            const revoked = await redis.get(`revoked:${token}`);
            redisRevoked = Boolean(revoked);
          } catch {
            // Fail closed on Redis errors: reconcile DB immediately (do not skip revoke checks)
            redisRevoked = false;
            heartbeatTick = 0; // force DB reconcile below
          }
          if (redisRevoked) {
            send({ type: 'revoked' });
            closed = true;
            clearInterval(pollInterval);
            controller.close();
            return;
          }

          heartbeatTick += 1;
          // Always reconcile Postgres every 3s (kill-switch ≤3s even if Redis is down)
          const mustReconcileDb = true;
          let link: { id: string; isRevoked: boolean; expiresAt: Date } | null = {
            id: cachedLinkId,
            isRevoked: false,
            expiresAt: cachedExpiresAt,
          };
          if (mustReconcileDb) {
            link = await prisma.secureLink.findUnique({
              where: { token },
              select: { isRevoked: true, expiresAt: true, id: true },
            });
            if (link) {
              cachedLinkId = link.id;
              cachedExpiresAt = link.expiresAt;
            }
          }

          if (!link || link.isRevoked) {
            send({ type: 'revoked' });
            closed = true;
            clearInterval(pollInterval);
            controller.close();
            return;
          }
          if (new Date() > link.expiresAt) {
            send({ type: 'expired' });
            closed = true;
            clearInterval(pollInterval);
            controller.close();
            return;
          }

          const threshold = new Date(Date.now() - 15000);
          const [activeSessions, recentChats] = await Promise.all([
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
              where: {
                secureLinkId: link.id,
                ...(lastChatTimestamp ? { timestamp: { gt: lastChatTimestamp } } : {}),
                OR: viewerEmail
                  ? [
                      { receiverEmail: null },
                      { senderEmail: viewerEmail },
                      { receiverEmail: viewerEmail },
                    ]
                  : [{ receiverEmail: null }],
              },
              orderBy: { timestamp: 'asc' },
              take: lastChatTimestamp ? 50 : 100,
              select: { id: true, senderEmail: true, receiverEmail: true, content: true, timestamp: true }
            }),
          ]);

          let highestActiveLevel = 99;
          activeSessions.forEach(session => {
             if (session.level < highestActiveLevel) highestActiveLevel = session.level;
          });
          if (recentChats.length > 0) {
            lastChatTimestamp = recentChats[recentChats.length - 1].timestamp;
          }

          // Push down state
          send({ 
              type: 'heartbeat', 
              timestamp: new Date().toISOString(),
              highestActiveLevel: highestActiveLevel === 99 ? null : highestActiveLevel,
              activeParticipants: activeSessions.map(s => ({ email: s.userId, name: s.displayName, level: s.level, color: s.color })),
              chats: recentChats
          });
        } catch {
          // On unexpected errors, force a DB revoke check once more then fail closed if revoked
          try {
            const link = await prisma.secureLink.findUnique({
              where: { token: token! },
              select: { isRevoked: true, expiresAt: true },
            });
            if (!link || link.isRevoked) {
              send({ type: 'revoked' });
              closed = true;
              clearInterval(pollInterval);
              controller.close();
              return;
            }
            if (new Date() > link.expiresAt) {
              send({ type: 'expired' });
              closed = true;
              clearInterval(pollInterval);
              controller.close();
              return;
            }
          } catch {
            send({ type: 'error', message: 'Monitor unavailable' });
            closed = true;
            clearInterval(pollInterval);
            try { controller.close(); } catch { /* already closed */ }
            return;
          }
          send({ type: 'heartbeat', timestamp: new Date().toISOString() });
        }
      }, SSE_POLL_MS);

      // Clean up if client disconnects
      req.signal.addEventListener('abort', () => {
        closed = true;
        clearInterval(pollInterval);
        try { controller.close(); } catch { /* already closed */ }
      });
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}
