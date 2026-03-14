import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/collaboration/[fileId]?token=&displayName=
 *
 * Upgrades the HTTP connection to WebSocket.
 * Broadcasts document operations and cursor positions to all room members.
 *
 * NOTE: Requires self-hosted Node.js deployment (Docker). Vercel does not
 * support raw WebSocket upgrades with the 'ws' package.
 *
 * Message protocol (JSON strings):
 *   Client → Server:
 *     { type: 'join', payload: { token, displayName, color } }
 *     { type: 'op',   payload: DocumentOperation }
 *     { type: 'cursor', payload: CursorPosition }
 *     { type: 'ping' }
 *
 *   Server → Client:
 *     { type: 'op:ack', payload: { opId, version } }
 *     { type: 'op',     payload: DocumentOperation }   — broadcast to room
 *     { type: 'cursor', payload: CursorPosition }
 *     { type: 'presence', payload: { users: [] } }
 *     { type: 'session', payload: { event: 'revoked'|'expired' } }
 *     { type: 'pong' }
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ fileId: string }> },
) {
  // WebSocket upgrade is handled at the server level via instrumentation.ts.
  // This route is a fallback for non-WS clients (health check).
  const { fileId } = await params;
  const token = req.nextUrl.searchParams.get('token');

  if (!token) return NextResponse.json({ error: 'Missing token' }, { status: 401 });

  const link = await prisma.secureLink.findUnique({ where: { token } });
  if (!link || link.isRevoked || new Date() > link.expiresAt) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
  }

  return NextResponse.json({
    status: 'ready',
    fileId,
    wsUrl: `/api/collaboration/${fileId}`,
    message: 'Connect via WebSocket',
  });
}
