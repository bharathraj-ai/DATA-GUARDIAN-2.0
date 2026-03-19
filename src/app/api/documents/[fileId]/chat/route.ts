import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { authorizeApiRequest } from '@/lib/api-auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/documents/[fileId]/chat
 * Body: { token, message, isPrivate, targetUser? }
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

    // Auth (Zero-Trust Session + API Security)
    const authResult = await authorizeApiRequest(fileId, token);
    if (authResult.errorResponse) {
      return authResult.errorResponse;
    }

    const { effectiveEmail, level } = authResult;
    
    // Fallback sender name to Anonymous if no email 
    // (though authorizeApiRequest stringently checks it for vendor links)
    const sender = effectiveEmail || 'Anonymous Vendor';

    const chatMessage = await prisma.chatMessage.create({
      data: {
        fileId,
        sender,
        level: level || 2,
        message,
        isPrivate,
        targetUser: isPrivate ? targetUser : null,
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

    const authResult = await authorizeApiRequest(fileId, token);
    if (authResult.errorResponse) {
      return authResult.errorResponse;
    }

    const { effectiveEmail } = authResult;
    const sender = effectiveEmail || 'Anonymous Vendor';

    // Fetch chat history.
    // If it's a private message, only return if it's sent BY this user OR sent TO this user
    const messages = await prisma.chatMessage.findMany({
      where: {
        fileId,
        OR: [
          { isPrivate: false },
          { isPrivate: true, sender },
          { isPrivate: true, targetUser: sender }
        ]
      },
      orderBy: { createdAt: 'asc' },
    });

    return NextResponse.json({ success: true, messages });
  } catch (err) {
    console.error('[chat GET] error:', err);
    return NextResponse.json({ error: 'Failed to fetch messages' }, { status: 500 });
  }
}
