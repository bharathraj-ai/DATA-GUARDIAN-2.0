import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { buildEditorConfig, getOnlyOfficeServerUrl } from '@/lib/onlyoffice/config';
import { checkDocumentPermission } from '@/lib/security/rbac';

/**
 * GET /api/onlyoffice/config/[fileId]
 *
 * Returns the signed ONLYOFFICE editor configuration for a document.
 *
 * This endpoint:
 *   1. Validates the user session (NextAuth)
 *   2. Checks RBAC permissions (view or edit)
 *   3. Builds the editor config with document URL & callback URL
 *   4. Signs the config with JWT
 *   5. Returns the config JSON + ONLYOFFICE server URL
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ fileId: string }> }
) {
  try {
    const { fileId } = await params;

    // ── Auth check ──────────────────────────────────────────────
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json(
        { error: 'Authentication required' },
        { status: 401 }
      );
    }

    const userId = session.user.id;
    const userRole = (session.user as { role?: string }).role || 'VENDOR';

    // ── Fetch document ──────────────────────────────────────────
    const document = await prisma.document.findUnique({
      where: { id: fileId, isDeleted: false },
    });

    if (!document) {
      return NextResponse.json(
        { error: 'Document not found' },
        { status: 404 }
      );
    }

    // ── Determine mode based on permissions ─────────────────────
    const editPermission = await checkDocumentPermission(userId, fileId, 'edit');
    const viewPermission = await checkDocumentPermission(userId, fileId, 'view');

    if (!viewPermission.allowed) {
      return NextResponse.json(
        { error: viewPermission.reason || 'Access denied' },
        { status: 403 }
      );
    }

    const mode = editPermission.allowed ? 'edit' : 'view';

    // ── Build base URL ──────────────────────────────────────────
    const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000';

    // ── Generate unique document key ────────────────────────────
    // Key changes when the document is modified → forces ONLYOFFICE to
    // reload the latest version instead of using its cache.
    const documentKey = `${document.id}_v${document.currentVersion}`;

    // ── Build signed config ─────────────────────────────────────
    const config = buildEditorConfig({
      document: {
        fileId: document.id,
        fileName: document.fileName,
        fileType: document.fileType,
        documentKey,
      },
      user: {
        id: userId,
        name: session.user.name || 'User',
      },
      baseUrl,
      mode,
    });

    return NextResponse.json({
      config,
      serverUrl: getOnlyOfficeServerUrl(),
      documentId: document.id,
      userRole,
    });
  } catch (error) {
    console.error('[ONLYOFFICE] Config generation error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
