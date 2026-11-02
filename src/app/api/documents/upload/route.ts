import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import {
  saveDocument,
  getMimeType,
  ensureStorageDirectories,
  deleteDocumentFiles,
} from '@/lib/storage/secureStorage';
import { hasRolePermission } from '@/lib/security/rbac';
import { logDocumentEvent, extractRequestInfo } from '@/lib/security/auditLog';
import { validateMagicBytesForExtension } from '@/lib/file-magic';
import { getDbUserRole } from '@/lib/security/roles';
import { checkUploadRateLimit, extractClientIP } from '@/lib/rate-limit';
import { sanitizeFileName } from '@/lib/security/filename';
import { headers } from 'next/headers';
import { logger } from '@/lib/logger';

/**
 * POST /api/documents/upload
 *
 * Upload a new document to secure storage.
 *
 * Flow:
 *   1. Validate session (must be authenticated)
 *   2. Check RBAC (must have 'upload' permission — OWNER role)
 *   3. Parse multipart form data
 *   4. Sanitize filename on the server (SV-01)
 *   5. Validate magic bytes against extension
 *   6. Secure File Storage Phase (DL-01):
 *      - File is written to disk BEFORE database record creation
 *      - Uses unique documentId per upload (concurrency safe)
 *      - If disk write fails, clean up temp files & return error (no DB record created)
 *   7. Database Phase (DL-01):
 *      - Insert Document record with finalized storagePath
 *      - If DB insert fails, rollback physical file immediately (prevent orphaned files)
 *   8. Log upload event
 *   9. Return document metadata
 */

const MAX_FILE_SIZE = 100 * 1024 * 1024; // 100 MB max

const ALLOWED_EXTENSIONS = new Set([
  'docx', 'doc', 'xlsx', 'xls', 'pptx', 'ppt',
  'odt', 'ods', 'odp', 'pdf', 'csv', 'txt', 'rtf',
]);

const VALID_CLASSIFICATIONS = new Set(['PUBLIC', 'INTERNAL', 'CONFIDENTIAL', 'RESTRICTED']);

export async function POST(request: NextRequest) {
  let createdDocumentId: string | null = null;
  let fileSavedOnDisk = false;

  try {
    // ── 1. Auth check ──────────────────────────────────────────────
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json(
        { error: 'Authentication required' },
        { status: 401 }
      );
    }

    const userId = session.user.id;
    const dbRole = await getDbUserRole(userId);
    if (!dbRole) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    }
    const userRole = dbRole.role;

    // ── 2. RBAC check (Postgres role — never JWT) ──────────────────
    if (!hasRolePermission(userRole, 'upload')) {
      return NextResponse.json(
        { error: 'You do not have permission to upload documents' },
        { status: 403 }
      );
    }

    // ── 3. Rate Limit check ─────────────────────────────────────────
    const requestHeaders = await headers();
    const clientIP = extractClientIP(requestHeaders);
    const rateLimit = await checkUploadRateLimit(clientIP);
    if (!rateLimit.allowed) {
      return NextResponse.json(
        { error: 'Rate limit exceeded for uploads. Please try again later.' },
        { status: 429 }
      );
    }

    // ── 4. Parse form data ─────────────────────────────────────────
    const formData = await request.formData();
    const file = formData.get('file') as File | null;
    const classification = (formData.get('classification') as string) || 'INTERNAL';

    if (!file) {
      return NextResponse.json(
        { error: 'No file provided' },
        { status: 400 }
      );
    }

    // ── 5. Validate file size ──────────────────────────────────────
    if (file.size > MAX_FILE_SIZE) {
      return NextResponse.json(
        { error: `File too large. Maximum size: ${MAX_FILE_SIZE / 1024 / 1024}MB` },
        { status: 400 }
      );
    }

    // ── 6. Sanitize filename on the server (SV-01) ─────────────────
    // Strips path traversal, CRLF, null bytes, control characters, and enforces length.
    // Validates extension against whitelist before preservation.
    let sanitized;
    try {
      sanitized = sanitizeFileName(file.name, ALLOWED_EXTENSIONS);
    } catch (err: any) {
      return NextResponse.json(
        { error: err.message || 'Invalid file name or extension' },
        { status: 400 }
      );
    }

    const { sanitizedFileName, extension: fileExtension } = sanitized;

    // Validate classification
    if (!VALID_CLASSIFICATIONS.has(classification)) {
      return NextResponse.json(
        { error: 'Invalid classification level' },
        { status: 400 }
      );
    }

    // ── 7. Validate magic bytes against declared extension ─────────
    const fileBuffer = Buffer.from(await file.arrayBuffer());

    if (!validateMagicBytesForExtension(fileBuffer, fileExtension)) {
      return NextResponse.json(
        { error: 'File content does not match declared type (possible spoofing)' },
        { status: 400 },
      );
    }

    // ── 8. Secure Storage Phase (DL-01 / GridFS Envelope Encryption) ─
    // Requirement: Prevent database records from being created before successful file storage.
    // Encrypt file with unique DEK (AES-256-GCM) and store in MongoDB GridFS (or secure storage).
    const documentId = crypto.randomUUID();
    createdDocumentId = documentId;

    let saved: any;
    try {
      await ensureStorageDirectories();
      saved = await saveDocument(documentId, sanitizedFileName, fileBuffer, {
        mimeType: getMimeType(fileExtension),
        uploadedBy: userId,
        classification,
      });
      fileSavedOnDisk = true;
    } catch (storageError) {
      logger.error('[UPLOAD] File storage write failed:', storageError);
      // Clean up any partially created temporary files / directories
      try {
        await deleteDocumentFiles(documentId);
      } catch {}
      return NextResponse.json(
        { error: 'Failed to write document to storage' },
        { status: 500 }
      );
    }

    // ── 9. Database Phase (DL-01) ──────────────────────────────────
    // File is securely and completely written. Now create DB record with full metadata.
    let document;
    try {
      document = await prisma.document.create({
        data: {
          id: documentId,
          fileName: sanitizedFileName,
          originalFilename: file.name,
          fileType: fileExtension,
          mimeType: getMimeType(fileExtension),
          storagePath: saved.storagePath,
          storageProvider: saved.storageProvider || (process.env.STORAGE_PROVIDER || 'mongodb'),
          storageFileId: saved.storageFileId || null,
          fileSize: file.size,
          encryptionAlgorithm: saved.encryptionAlgorithm || 'aes-256-gcm',
          encryptionIV: saved.encryptionIV || null,
          authenticationTag: saved.authenticationTag || null,
          encryptedDEK: saved.encryptedDEK || null,
          storageCreatedAt: new Date(),
          ownerId: userId,
          classification,
        },
      });
    } catch (dbError) {
      logger.error('[UPLOAD] Database record creation failed, cleaning up stored file:', dbError);
      // Requirement: Prevent orphaned files when DB operations fail
      try {
        await deleteDocumentFiles(documentId);
        fileSavedOnDisk = false;
      } catch (cleanupErr) {
        logger.error('[UPLOAD] Failed to rollback stored file after DB error:', cleanupErr);
      }
      return NextResponse.json(
        { error: 'Failed to record document metadata' },
        { status: 500 }
      );
    }

    // ── 10. Audit log ───────────────────────────────────────────────
    const { ipAddress, userAgent } = extractRequestInfo(request);
    logDocumentEvent({
      documentId: document.id,
      userId,
      action: 'upload',
      ipAddress,
      userAgent,
      metadata: {
        fileName: document.fileName,
        fileSize: document.fileSize,
        fileType: document.fileType,
        classification: document.classification,
        storageProvider: document.storageProvider,
        storageFileId: document.storageFileId,
        encryptionAlgorithm: document.encryptionAlgorithm,
        virusScan: 'pending_hook',
      },
    });

    // ── 11. Response ────────────────────────────────────────────────
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
    logger.error('[UPLOAD] Error uploading document:', error);
    // Safety recovery: clean up stored file if created
    if (createdDocumentId && fileSavedOnDisk) {
      try {
        await deleteDocumentFiles(createdDocumentId);
      } catch {}
    }
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
