import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { authorizeApiRequest } from '@/lib/api-auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET  /api/documents/[fileId]/annotations?token=
 * POST /api/documents/[fileId]/annotations  { token, annotation }
 * DELETE /api/documents/[fileId]/annotations?token=&id=
 */

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ fileId: string }> },
) {
  try {
    const { fileId } = await params;
    const token = req.nextUrl.searchParams.get('token');
    if (!token) return NextResponse.json({ error: 'Missing token' }, { status: 401 });

    const authResult = await authorizeApiRequest(fileId, token);
    if (authResult.errorResponse) {
      return authResult.errorResponse;
    }
    const { file } = authResult;

    const annotations = await prisma.annotation.findMany({
      where: { fileId },
      orderBy: { createdAt: 'asc' },
    });

    return NextResponse.json({ success: true, annotations });
  } catch (err) {
    console.error('[annotations GET]', err);
    return NextResponse.json({ error: 'Failed to fetch annotations' }, { status: 500 });
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ fileId: string }> },
) {
  try {
    const { fileId } = await params;
    const body = (await req.json()) as {
      token: string;
      annotation: {
        id?: string;
        pageNumber: number;
        type: string;
        data: object;
        authorId?: string;
      };
    };

    const { token, annotation } = body;
    if (!token || !annotation) return NextResponse.json({ error: 'Missing fields' }, { status: 400 });

    const authResult = await authorizeApiRequest(fileId, token);
    if (authResult.errorResponse) {
      return authResult.errorResponse;
    }
    const { file } = authResult;

    // Upsert by annotation.id if provided
    const saved = annotation.id
      ? await prisma.annotation.upsert({
          where: { id: annotation.id },
          update: { data: JSON.stringify(annotation.data), updatedAt: new Date() },
          create: {
            id: annotation.id,
            fileId,
            pageNumber: annotation.pageNumber,
            type: annotation.type,
            data: JSON.stringify(annotation.data),
            authorId: annotation.authorId,
          },
        })
      : await prisma.annotation.create({
          data: {
            fileId,
            pageNumber: annotation.pageNumber,
            type: annotation.type,
            data: JSON.stringify(annotation.data),
            authorId: annotation.authorId,
          },
        });

    return NextResponse.json({ success: true, annotation: saved });
  } catch (err) {
    console.error('[annotations POST]', err);
    return NextResponse.json({ error: 'Failed to save annotation' }, { status: 500 });
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ fileId: string }> },
) {
  try {
    const { fileId } = await params;
    const token = req.nextUrl.searchParams.get('token');
    const id = req.nextUrl.searchParams.get('id');
    if (!token || !id) return NextResponse.json({ error: 'Missing token/id' }, { status: 400 });

    const authResult = await authorizeApiRequest(fileId, token);
    if (authResult.errorResponse) {
      return authResult.errorResponse;
    }
    const { file } = authResult;

    await prisma.annotation.delete({ where: { id } });
    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('[annotations DELETE]', err);
    return NextResponse.json({ error: 'Failed to delete annotation' }, { status: 500 });
  }
}
