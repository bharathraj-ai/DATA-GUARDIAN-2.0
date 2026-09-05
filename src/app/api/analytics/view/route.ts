import { NextRequest, NextResponse } from 'next/server';
import { authorizeSecureLink } from '@/lib/linkAuthorization';
import { prisma } from '@/lib/prisma';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/analytics/view
 * Body: { token, fileId, pageNumber? }
 * Records a file/page preview for the owner dashboard.
 */
export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as {
      token?: string;
      fileId?: string;
      pageNumber?: number;
    };
    const token = body.token?.trim();
    const fileId = body.fileId?.trim();
    const pageNumber = Number.isFinite(body.pageNumber) ? Math.max(1, Math.floor(body.pageNumber as number)) : 1;
    if (!token || !fileId) {
      return NextResponse.json({ error: 'Missing fields' }, { status: 400 });
    }

    const authResult = await authorizeSecureLink(token, 'preview', fileId);
    if (!authResult.success) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const linkId = authResult.context.secureLink.id;
    const viewerEmail = authResult.context.effectiveEmail?.toLowerCase() || null;

    const recent = await prisma.fileViewEvent.findFirst({
      where: {
        linkId,
        fileId,
        viewerEmail,
        createdAt: { gte: new Date(Date.now() - 15_000) },
      },
      select: { id: true },
    });
    if (recent) {
      return NextResponse.json({ success: true, deduped: true });
    }

    await prisma.fileViewEvent.create({
      data: { linkId, fileId, viewerEmail, pageNumber },
    });

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('[analytics/view]', err);
    return NextResponse.json({ error: 'Failed' }, { status: 500 });
  }
}
