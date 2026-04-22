import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export async function POST(req: NextRequest) {
    try {
        const body = await req.json();
        const { token, senderEmail, receiverEmail, content } = body;

        if (!token || !senderEmail || !content) {
            return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
        }

        const link = await prisma.secureLink.findUnique({
            where: { token },
            select: { id: true }
        });

        if (!link) {
            return NextResponse.json({ error: 'Invalid session' }, { status: 404 });
        }

        const message = await prisma.chatMessage.create({
            data: {
                secureLinkId: link.id,
                senderEmail,
                receiverEmail: receiverEmail || null,
                content
            }
        });

        return NextResponse.json({ success: true, message });
    } catch (error) {
        console.error('Chat Error:', error);
        return NextResponse.json({ error: 'Failed to send message' }, { status: 500 });
    }
}
