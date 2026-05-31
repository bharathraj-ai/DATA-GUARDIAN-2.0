import { NextRequest } from 'next/server';
import { cookies } from 'next/headers';
import { authorizeSecureLink } from '@/lib/linkAuthorization';
import { prisma } from '@/lib/prisma';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/session-monitor?token=
 *
 * Server-Sent Events endpoint.
 * Polls Redis every 3 seconds for link revocation flags.
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

  const authResult = await authorizeSecureLink(token, 'view');
  if (!authResult.success) {
    // Try to find the link ID for the audit log
    const link = await prisma.secureLink.findUnique({ where: { token }, select: { id: true } });
    if (link) {
      await prisma.auditLog.create({
        data: {
          action: 'SESSION_MONITOR_DENIED',
          linkId: link.id,
          reason: 'Unauthorized session monitor access attempt',
          metadata: JSON.stringify({ error: authResult.error })
        }
      }).catch(() => {});
    }
    return new Response('Unauthorized', { status: 403 });
  }

  await prisma.auditLog.create({
    data: {
      action: 'SESSION_MONITOR_CONNECTED',
      linkId: authResult.context.secureLink.id,
      reason: 'User connected to SSE session monitor',
      metadata: JSON.stringify({
         email: authResult.context.effectiveEmail || 'owner'
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

      const pollInterval = setInterval(async () => {
        if (closed) { clearInterval(pollInterval); return; }
        try {
          // Check Redis for revocation flag (set by revoke-access action)
          const revoked = await redis.get(`revoked:${token}`);
          if (revoked) {
            send({ type: 'revoked' });
            closed = true;
            clearInterval(pollInterval);
            controller.close();
            return;
          }

          // DB fallback check
          const link = await prisma.secureLink.findUnique({
            where: { token },
            select: { isRevoked: true, expiresAt: true, id: true },
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

          // Presence check (who is currently active within last 15s)
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

          // Compute highest authority (lowest level number)
          let highestActiveLevel = 99;
          activeSessions.forEach(session => {
             if (session.level < highestActiveLevel) highestActiveLevel = session.level;
          });

          // Fetch recent chat messages
          const recentChats = await prisma.chatMessage.findMany({
            where: { secureLinkId: link.id },
            orderBy: { timestamp: 'asc' },
            take: 100,
            select: { id: true, senderEmail: true, receiverEmail: true, content: true, timestamp: true }
          });

          // Push down state
          send({ 
              type: 'heartbeat', 
              timestamp: new Date().toISOString(),
              highestActiveLevel: highestActiveLevel === 99 ? null : highestActiveLevel,
              activeParticipants: activeSessions.map(s => ({ email: s.userId, name: s.displayName, level: s.level, color: s.color })),
              chats: recentChats
          });
        } catch {
          // Network hiccup — keep polling
          send({ type: 'heartbeat', timestamp: new Date().toISOString() });
        }
      }, 3000);

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
