import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import {
  saveDocument,
  getMimeType,
  getFileExtension,
  ensureStorageDirectories,
} from '@/lib/storage/secureStorage';
import { hasRolePermission } from '@/lib/security/rbac';
import { logDocumentEvent, extractRequestInfo } from '@/lib/security/auditLog';

/**
 * POST /api/documents/upload
 *
 * Upload a new document to secure storage.
 *
 * Flow:
 *   1. Validate session (must be authenticated)
 *   2. Check RBAC (must have 'upload' permission — OWNER role)
 *   3. Parse multipart form data
 *   4. Save file to secure storage
 *   5. Create Document record in DB
 *   6. Log upload event
 *   7. Return document metadata
 *
 * Body: multipart/form-data with fields:
 *   - file: The document file
 *   - classification: Optional ("PUBLIC" | "INTERNAL" | "CONFIDENTIAL" | "RESTRICTED")
 */

const MAX_FILE_SIZE = 100 * 1024 * 1024; // 100 MB

const ALLOWED_EXTENSIONS = new Set([
  'docx', 'doc', 'xlsx', 'xls', 'pptx', 'ppt',
  'odt', 'ods', 'odp', 'pdf', 'csv', 'txt', 'rtf',
]);

export async function POST(request: NextRequest) {
  try {
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

    // ── RBAC check ──────────────────────────────────────────────
    if (!hasRolePermission(userRole, 'upload')) {
      return NextResponse.json(
        { error: 'You do not have permission to upload documents' },
        { status: 403 }
      );
    }

    // ── Parse form data ─────────────────────────────────────────
    const formData = await request.formData();
    const file = formData.get('file') as File | null;
    const classification = (formData.get('classification') as string) || 'INTERNAL';

    if (!file) {
      return NextResponse.json(
        { error: 'No file provided' },
        { status: 400 }
      );
    }

    // ── Validate file ───────────────────────────────────────────
    if (file.size > MAX_FILE_SIZE) {
      return NextResponse.json(
        { error: `File too large. Maximum size: ${MAX_FILE_SIZE / 1024 / 1024}MB` },
        { status: 400 }
      );
    }

    const fileExtension = getFileExtension(file.name);
    if (!ALLOWED_EXTENSIONS.has(fileExtension)) {
      return NextResponse.json(
        { error: `File type '.${fileExtension}' is not allowed` },
        { status: 400 }
      );
    }

    // Validate classification
    const validClassifications = ['PUBLIC', 'INTERNAL', 'CONFIDENTIAL', 'RESTRICTED'];
    if (!validClassifications.includes(classification)) {
      return NextResponse.json(
        { error: 'Invalid classification level' },
        { status: 400 }
      );
    }

    // ── Save to secure storage ──────────────────────────────────
    await ensureStorageDirectories();

    const fileBuffer = Buffer.from(await file.arrayBuffer());

    // Create document record first to get the ID
    const document = await prisma.document.create({
      data: {
        fileName: file.name,
        fileType: fileExtension,
        mimeType: getMimeType(fileExtension),
        storagePath: '', // Will update after saving
        fileSize: file.size,
        ownerId: userId,
        classification,
      },
    });

    // Save file using document ID as directory name
    const { storagePath } = await saveDocument(document.id, file.name, fileBuffer);

    // Update storage path
    await prisma.document.update({
      where: { id: document.id },
      data: { storagePath },
    });

    // ── Audit log ───────────────────────────────────────────────
    const { ipAddress, userAgent } = extractRequestInfo(request);
    logDocumentEvent({
      documentId: document.id,
      userId,
      action: 'upload',
      ipAddress,
      userAgent,
      metadata: {
        fileName: file.name,
        fileSize: file.size,
        fileType: fileExtension,
        classification,
      },
    });

    // ── Response ────────────────────────────────────────────────
    return NextResponse.json({
      success: true,
      document: {
        id: document.id,
        fileName: document.fileName,
        fileType: document.fileType,
        fileSize: document.fileSize,
        classification: document.classification,
        createdAt: document.createdAt,
      },
    });
  } catch (error) {
    console.error('[UPLOAD] Error uploading document:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
