import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { cookies } from 'next/headers';
import { verifyShareSession } from '@/lib/share-session';
import { extractClientIP, checkGlobalRateLimit } from '@/lib/rate-limit';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * POST /api/audit
 * Receives client-side security events from SecurityShield.
 *
 * IDOR / abuse controls:
 * - Signed session must match the share token (cannot pollute another link's audit)
 * - Action allowlist
 * - Rate limited
 * - Uniform responses (no token oracle)
 */

const ALLOWED_ACTIONS = new Set([
  'TAB_SWITCH',
  'PRINT_SCREEN',
  'DEVTOOLS',
  'COPY',
  'CONTEXT_MENU',
  'BLUR',
  'VISIBILITY',
  'SESSION_TERMINATE',
  'KEY_BLOCK',
  'FOCUS_LOSS',
]);

function sanitizeAuditMetadata(metadata: unknown) {
  if (!metadata || typeof metadata !== 'object') return {};

  const allowed = ['screenWidth', 'screenHeight', 'visibility', 'page', 'browser'];
  const sanitized: Record<string, unknown> = {};
  const src = metadata as Record<string, unknown>;

  for (const key of allowed) {
    if (key in src) {
      sanitized[key] = src[key];
    }
  }

  return sanitized;
}

export async function POST(request: NextRequest) {
  try {
    const ip = extractClientIP(request.headers);
    const rl = await checkGlobalRateLimit(ip);
    if (!rl.allowed) {
      return NextResponse.json({ ok: true });
    }

    const body = await request.json();
    const { token, action, timestamp, metadata } = body as {
      token?: string;
      action?: string;
      timestamp?: unknown;
      metadata?: unknown;
    };

    // Silent uniform success — never leak validity of token/session
    if (!token || !action || typeof action !== 'string') {
      return NextResponse.json({ ok: true });
    }

    const normalizedAction = action.replace(/^CLIENT_/, '').toUpperCase();
    if (!ALLOWED_ACTIONS.has(normalizedAction)) {
      return NextResponse.json({ ok: true });
    }

    const cookieStore = await cookies();
    const verified = verifyShareSession(cookieStore.get('session_id')?.value, token);
    if (!verified.valid) {
      return NextResponse.json({ ok: true });
    }

    const secureLink = await prisma.secureLink.findUnique({
      where: { token },
      select: { id: true, isRevoked: true, expiresAt: true },
    });

    if (!secureLink || secureLink.isRevoked || secureLink.expiresAt < new Date()) {
      return NextResponse.json({ ok: true });
    }

    const sanitizedMetadata = sanitizeAuditMetadata(metadata);

    await prisma.auditLog.create({
      data: {
        action: `CLIENT_${normalizedAction}`,
        linkId: secureLink.id,
        reason: `Client security event: ${normalizedAction}`,
        metadata: JSON.stringify({
          ...sanitizedMetadata,
          clientTimestamp: timestamp,
          clientIp: ip.substring(0, 6) + '***',
          sessionId: verified.sessionId.substring(0, 8) + '...',
          userAgent: request.headers.get('user-agent')?.substring(0, 100),
        }),
      },
    });

    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ ok: true });
  }
}
