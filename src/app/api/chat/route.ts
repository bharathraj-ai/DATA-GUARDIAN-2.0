import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { auth } from '@/lib/auth';
import { extractClientIP, checkSecureChatRateLimits, formatRateLimitError } from '@/lib/rate-limit';

/**
 * POST /api/chat
 * Secure-link group chat — sender identity is taken ONLY from the authenticated session
 * (never from JSON) to prevent impersonation.
 */
export async function POST(req: NextRequest) {
  try {
    const session = await auth();
    const senderEmail = session?.user?.email?.toLowerCase().trim();
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
        allowedVendorEmail: true,
        LinkAccess: { select: { vendorEmail: true, lockedAt: true } },
        VendorAccess: { select: { email: true, isRevoked: true } },
      },
    });

    if (!link || link.isRevoked || link.lockedAt || link.expiresAt < new Date()) {
      return NextResponse.json({ error: 'Invalid or expired link' }, { status: 404 });
    }

    const allowed =
      (link.allowedVendorEmail && link.allowedVendorEmail.toLowerCase() === senderEmail) ||
      link.VendorAccess.some((v) => v.email === senderEmail && !v.isRevoked) ||
      link.LinkAccess.some((a) => a.vendorEmail.toLowerCase() === senderEmail && !a.lockedAt);

    if (!allowed) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const message = await prisma.chatMessage.create({
      data: {
        secureLinkId: link.id,
        senderEmail,
        receiverEmail: receiverEmail || null,
        content,
      },
    });

    return NextResponse.json({ success: true, message });
  } catch (error) {
    console.error('Chat Error:', error);
    return NextResponse.json({ error: 'Failed to send message' }, { status: 500 });
  }
}
