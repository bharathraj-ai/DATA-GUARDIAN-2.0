import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { authorizeApiRequest } from '@/lib/api-auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_MESSAGE_CHARS = 8000;

/**
 * POST /api/documents/[fileId]/chat
 * Body: { token, message, isPrivate, targetUser? }
 * Sender identity is taken from the authorized session — never from the client body.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ fileId: string }> },
) {
  try {
    const { fileId } = await params;
    const body = await req.json();
    const { token, message, isPrivate = false, targetUser } = body;

    if (!token || !message) return NextResponse.json({ error: 'Missing fields' }, { status: 400 });
    if (typeof message !== 'string' || message.trim().length === 0) {
      return NextResponse.json({ error: 'Invalid message' }, { status: 400 });
    }
    if (message.length > MAX_MESSAGE_CHARS) {
      return NextResponse.json({ error: 'Message too long' }, { status: 413 });
    }

    const authResult = await authorizeApiRequest(fileId, token, {
      httpMethod: req.method,
      action: 'comment',
    });
    if (authResult.errorResponse) {
      return authResult.errorResponse;
    }

    const { effectiveEmail, level, secureLink } = authResult;
    const sender = effectiveEmail;
    if (!sender) {
      return NextResponse.json({ error: 'Forbidden: Identity required for chat' }, { status: 403 });
    }

    // Private target must be a participant on this link (when email gate exists)
    let safeTarget: string | null = null;
    if (isPrivate && typeof targetUser === 'string' && targetUser.trim()) {
      const target = targetUser.trim().toLowerCase();
      const participants = new Set<string>();
      if (secureLink.allowedVendorEmail) {
        participants.add(secureLink.allowedVendorEmail.toLowerCase());
      }
      for (const v of secureLink.VendorAccess) participants.add(v.email.toLowerCase());
      for (const a of secureLink.LinkAccess) participants.add(a.vendorEmail.toLowerCase());
      if (participants.size > 0 && !participants.has(target)) {
        return NextResponse.json({ error: 'Forbidden: Invalid private chat target' }, { status: 403 });
      }
      safeTarget = target;
    }

    const chatMessage = await prisma.documentChatMessage.create({
      data: {
        fileId,
        sender,
        level: level || 2,
        message: message.trim(),
        isPrivate: Boolean(isPrivate),
        targetUser: isPrivate ? safeTarget : null,
      },
    });

    return NextResponse.json({ success: true, chatMessage });
  } catch (err) {
    console.error('[chat POST] error:', err);
    return NextResponse.json({ error: 'Failed to send message' }, { status: 500 });
  }
}

/**
 * GET /api/documents/[fileId]/chat
 * Query: ?token=xxx
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ fileId: string }> },
) {
  try {
    const { fileId } = await params;
    const { searchParams } = new URL(req.url);
    const token = searchParams.get('token');

    if (!token) return NextResponse.json({ error: 'Missing token' }, { status: 400 });

    const authResult = await authorizeApiRequest(fileId, token, {
      httpMethod: req.method,
      action: 'view',
    });
    if (authResult.errorResponse) {
      return authResult.errorResponse;
    }

    const { effectiveEmail } = authResult;
    const sender = effectiveEmail;
    if (!sender) {
      return NextResponse.json({ error: 'Forbidden: Identity required for chat' }, { status: 403 });
    }

    const messages = await prisma.documentChatMessage.findMany({
      where: {
        fileId,
        isSystem: false,
        OR: [
          { isPrivate: false },
          { isPrivate: true, sender },
          { isPrivate: true, targetUser: sender },
        ],
      },
      orderBy: { createdAt: 'asc' },
      take: 500,
      select: {
        id: true,
        fileId: true,
        sender: true,
        level: true,
        message: true,
        isPrivate: true,
        targetUser: true,
        createdAt: true,
      },
    });

    return NextResponse.json({ success: true, messages });
  } catch (err) {
    console.error('[chat GET] error:', err);
    return NextResponse.json({ error: 'Failed to fetch messages' }, { status: 500 });
  }
}
