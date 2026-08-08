import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { readDocument, getMimeType } from '@/lib/storage/secureStorage';
import { checkDocumentPermission } from '@/lib/security/rbac';
import { logDocumentEvent, extractRequestInfo } from '@/lib/security/auditLog';

/**
 * GET /api/files/[fileId]
 *
 * Secure document streaming endpoint.
 * Used by:
 *   1. Browser clients (authenticated via NextAuth session)
 *
 * Flow:
 *   1. Authenticate (session)
 *   2. Check RBAC permissions
 *   3. Fetch metadata from DB
 *   4. Stream file from secure storage
 *   5. Log the access event
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ fileId: string }> }
) {
  try {
    const { fileId } = await params;

    // ── Authentication: try session ──────────────
    let userId: string | null = null;

    // Try NextAuth session
    const session = await auth();
    if (session?.user?.id) {
      userId = session.user.id;
    }

    // Must have a session
    if (!userId) {
      return NextResponse.json(
        { error: 'Authentication required' },
        { status: 401 }
      );
    }

    // ── Fetch document metadata ─────────────────────────────────
    const document = await prisma.document.findUnique({
      where: { id: fileId, isDeleted: false },
    });

    if (!document) {
      return NextResponse.json(
        { error: 'Document not found' },
        { status: 404 }
      );
    }

    // ── RBAC check (deny-by-default; owner, explicit grant, or break-glass staff) ─
    const isDownload = request.nextUrl.searchParams.get('download') === 'true';
    const permission = await checkDocumentPermission(
      userId,
      fileId,
      isDownload ? 'download' : 'view',
    );
    if (!permission.allowed) {
      return NextResponse.json(
        { error: permission.reason || 'Access denied' },
        { status: 403 }
      );
    }

    // ── Stream file from secure storage ─────────────────────────
    const fileBuffer = await readDocument(document.storagePath);
    const mimeType = getMimeType(document.fileType);

    const disposition = isDownload
      ? `attachment; filename="${encodeURIComponent(document.fileName)}"`
      : `inline; filename="${encodeURIComponent(document.fileName)}"`;

    // ── Audit log (non-blocking) ────────────────────────────────
    const { ipAddress, userAgent } = extractRequestInfo(request);
    logDocumentEvent({
      documentId: fileId,
      userId: userId,
      action: isDownload ? 'download' : 'view',
      ipAddress,
      userAgent,
      metadata: permission.elevatedBreakGlass
        ? { elevatedBreakGlassAccess: true, reason: 'Break-glass document access' }
        : undefined,
    });

    // ── Return file with security headers ───────────────────────
    return new NextResponse(new Uint8Array(fileBuffer), {
      status: 200,
      headers: {
        'Content-Type': mimeType,
        'Content-Length': fileBuffer.length.toString(),
        'Content-Disposition': disposition,
        'Cache-Control': 'no-store, no-cache, must-revalidate',
        'X-Content-Type-Options': 'nosniff',
        'X-Frame-Options': 'DENY',
      },
    });
  } catch (error) {
    console.error('[FILES] Error streaming document:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
