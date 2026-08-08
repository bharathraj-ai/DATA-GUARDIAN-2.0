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

const ALLOWED_TYPES = new Set(['highlight', 'text', 'draw', 'comment', 'signature']);

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ fileId: string }> },
) {
  try {
    const { fileId } = await params;
    const token = req.nextUrl.searchParams.get('token');
    if (!token) return NextResponse.json({ error: 'Missing token' }, { status: 401 });

    const authResult = await authorizeApiRequest(fileId, token, {
      httpMethod: req.method,
      action: 'view',
    });
    if (authResult.errorResponse) {
      return authResult.errorResponse;
    }

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

    const authResult = await authorizeApiRequest(fileId, token, {
      httpMethod: req.method,
      action: 'view',
    });
    if (authResult.errorResponse) {
      return authResult.errorResponse;
    }

    const { effectiveEmail, capabilities } = authResult;
    if (!capabilities.canComment && !capabilities.canEdit) {
      return NextResponse.json({ error: 'Forbidden: Comment/edit access denied' }, { status: 403 });
    }

    if (!Number.isFinite(annotation.pageNumber) || annotation.pageNumber < 1) {
      return NextResponse.json({ error: 'Invalid pageNumber' }, { status: 400 });
    }
    if (!ALLOWED_TYPES.has(annotation.type)) {
      return NextResponse.json({ error: 'Invalid annotation type' }, { status: 400 });
    }

    const authorId = effectiveEmail || null;
    const dataJson = JSON.stringify(annotation.data ?? {});
    if (dataJson.length > 100_000) {
      return NextResponse.json({ error: 'Annotation payload too large' }, { status: 413 });
    }

    // Upsert scoped to this fileId — prevents cross-file IDOR overwrites
    let saved;
    if (annotation.id) {
      const existing = await prisma.annotation.findUnique({
        where: { id: annotation.id },
        select: { id: true, fileId: true },
      });

      if (existing && existing.fileId !== fileId) {
        return NextResponse.json({ error: 'Forbidden: Annotation belongs to another file' }, { status: 403 });
      }

      if (existing) {
        saved = await prisma.annotation.update({
          where: { id: existing.id },
          data: {
            data: dataJson,
            pageNumber: annotation.pageNumber,
            type: annotation.type,
            updatedAt: new Date(),
          },
        });
      } else {
        saved = await prisma.annotation.create({
          data: {
            id: annotation.id,
            fileId,
            pageNumber: annotation.pageNumber,
            type: annotation.type,
            data: dataJson,
            authorId,
          },
        });
      }
    } else {
      saved = await prisma.annotation.create({
        data: {
          fileId,
          pageNumber: annotation.pageNumber,
          type: annotation.type,
          data: dataJson,
          authorId,
        },
      });
    }

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

    const authResult = await authorizeApiRequest(fileId, token, {
      httpMethod: req.method,
      action: 'view',
    });
    if (authResult.errorResponse) {
      return authResult.errorResponse;
    }

    if (!authResult.capabilities.canComment && !authResult.capabilities.canEdit) {
      return NextResponse.json({ error: 'Forbidden: Comment/edit access denied' }, { status: 403 });
    }

    // Scope delete to this file — prevents cross-file IDOR
    const result = await prisma.annotation.deleteMany({
      where: { id, fileId },
    });
    if (result.count === 0) {
      return NextResponse.json({ error: 'Annotation not found' }, { status: 404 });
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('[annotations DELETE]', err);
    return NextResponse.json({ error: 'Failed to delete annotation' }, { status: 500 });
  }
}
