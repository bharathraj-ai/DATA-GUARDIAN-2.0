import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { auth } from '@/lib/auth';
import { extractClientIP, checkSecureChatRateLimits, formatRateLimitError } from '@/lib/rate-limit';
import { isLinkParticipant, normalizeEmail } from '@/lib/security/resource-ownership';
import { verifyShareSession } from '@/lib/share-session';
import { cookies } from 'next/headers';

/**
 * POST /api/chat
 * Secure-link group chat — sender from session; receiver must be a link participant.
 * Requires signed share session bound to token (IDOR-safe).
 */
export async function POST(req: NextRequest) {
  try {
    const session = await auth();
    const senderEmail = normalizeEmail(session?.user?.email);
    if (!senderEmail) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    }

    const ip = extractClientIP(req.headers);
    const body = await req.json();
    const { token, content, receiverEmail } = body as {
      token?: string;
      content?: string;
      receiverEmail?: string | null;
    };

    if (!token || !content || typeof content !== 'string') {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    if (content.length > 8000) {
      return NextResponse.json({ error: 'Message too long' }, { status: 400 });
    }

    // Bind session cookie to this token — blocks writing chat to another link
    const cookieStore = await cookies();
    const verified = verifyShareSession(cookieStore.get('session_id')?.value, token);
    if (!verified.valid) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const rl = await checkSecureChatRateLimits(ip, token);
    if (!rl.allowed) {
      return NextResponse.json({ error: formatRateLimitError(rl) }, { status: 429 });
    }

    const link = await prisma.secureLink.findUnique({
      where: { token },
      select: {
        id: true,
        isRevoked: true,
        expiresAt: true,
        lockedAt: true,
        ownerId: true,
        allowedVendorEmail: true,
        LinkAccess: { select: { vendorEmail: true, lockedAt: true } },
        VendorAccess: { select: { email: true, isRevoked: true } },
      },
    });

    if (!link || link.isRevoked || link.lockedAt || link.expiresAt < new Date()) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const isOwner = Boolean(session?.user?.id && session.user.id === link.ownerId);
    if (!isOwner && !isLinkParticipant(senderEmail, link)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    let safeReceiver: string | null = null;
    if (receiverEmail != null && receiverEmail !== '') {
      const target = normalizeEmail(String(receiverEmail));
      if (!target) {
        return NextResponse.json({ error: 'Invalid receiver' }, { status: 400 });
      }
      if (!isLinkParticipant(target, link)) {
        return NextResponse.json({ error: 'Forbidden: Invalid recipient' }, { status: 403 });
      }
      safeReceiver = target;
    }

    const message = await prisma.chatMessage.create({
      data: {
        secureLinkId: link.id,
        senderEmail,
        receiverEmail: safeReceiver,
        content: content.trim(),
      },
    });

    return NextResponse.json({ success: true, message });
  } catch (error) {
    console.error('Chat Error:', error);
    return NextResponse.json({ error: 'Failed to send message' }, { status: 500 });
  }
}
