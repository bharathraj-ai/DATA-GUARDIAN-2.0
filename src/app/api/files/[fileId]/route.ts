import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { readDocument, getMimeType } from '@/lib/storage/secureStorage';
import { checkDocumentPermission } from '@/lib/security/rbac';
import { logDocumentEvent, extractRequestInfo } from '@/lib/security/auditLog';
import { verifyOnlyOfficeToken, extractBearerToken } from '@/lib/onlyoffice/jwt';

/**
 * GET /api/files/[fileId]
 *
 * Secure document streaming endpoint.
 * Used by both:
 *   1. Browser clients (authenticated via NextAuth session)
 *   2. ONLYOFFICE Document Server (authenticated via JWT Bearer token)
 *
 * Flow:
 *   1. Authenticate (session OR JWT)
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

    // ── Authentication: try session first, then JWT ──────────────
    let userId: string | null = null;
    let isOnlyOfficeRequest = false;

    // Try NextAuth session
    const session = await auth();
    if (session?.user?.id) {
      userId = session.user.id;
    }

    // If no session, try ONLYOFFICE JWT Bearer token
    if (!userId) {
      const authHeader = request.headers.get('authorization');
      const token = extractBearerToken(authHeader);
      if (token) {
        try {
          verifyOnlyOfficeToken(token);
          isOnlyOfficeRequest = true;
          // ONLYOFFICE requests are trusted after JWT verification
        } catch {
          return NextResponse.json(
            { error: 'Invalid or expired token' },
            { status: 401 }
          );
        }
      }
    }

    // Must have either a session or valid JWT
    if (!userId && !isOnlyOfficeRequest) {
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

    // ── RBAC check (skip for ONLYOFFICE — already JWT-verified) ─
    if (userId && !isOnlyOfficeRequest) {
      const permission = await checkDocumentPermission(userId, fileId, 'view');
      if (!permission.allowed) {
        return NextResponse.json(
          { error: permission.reason || 'Access denied' },
          { status: 403 }
        );
      }
    }

    // ── Stream file from secure storage ─────────────────────────
    const fileBuffer = await readDocument(document.storagePath);
    const mimeType = getMimeType(document.fileType);

    // Determine if this is a download (query param) or inline view
    const isDownload = request.nextUrl.searchParams.get('download') === 'true';
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
      metadata: { isOnlyOfficeRequest },
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
