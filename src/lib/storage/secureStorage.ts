import fs from 'fs/promises';
import path from 'path';

/**
 * Secure File Storage Utility
 *
 * All documents are stored on the local filesystem in a directory
 * that is NEVER publicly accessible. Only backend API routes can
 * read/write these files after proper authentication and RBAC checks.
 *
 * Directory layout:
 *   {SECURE_STORAGE_PATH}/
 *     documents/{documentId}/{fileName}
 *     versions/{documentId}/{version}.{ext}
 */

export function getStorageRoot(): string {
  const configured = process.env.SECURE_STORAGE_PATH;
  if (configured && configured.trim()) {
    return path.resolve(configured.trim());
  }
  if (process.env.NODE_ENV === 'production') {
    return '/app/storage-vault';
  }
  return path.resolve(process.cwd(), '.secure-storage');
}

/** True if resolved path is exactly root or a path under root (sep-safe). */
function isPathInsideRoot(resolved: string, root: string): boolean {
  const normalizedRoot = root.endsWith(path.sep) ? root.slice(0, -1) : root;
  return resolved === normalizedRoot || resolved.startsWith(normalizedRoot + path.sep);
}

/** Basename-only filename (no directories). Exported for tests + create-link. */
export function safeBaseName(fileName: string): string {
  if (!fileName || /[/\\]/.test(fileName)) {
    throw new Error('Path traversal detected — file name must be basename only');
  }
  if (fileName.includes('\0')) {
    throw new Error('Path traversal detected — null byte in file name');
  }
  if (fileName.includes('..')) {
    throw new Error('Path traversal detected — parent segment in file name');
  }
  const base = path.basename(fileName);
  if (!base || base === '.' || base === '..') {
    throw new Error('Invalid file name');
  }
  return base;
}

/** Reject path segments that could escape (absolute, .., empty). Exported for tests. */
export function assertSafeSegment(segment: string, label: string): string {
  if (!segment || typeof segment !== 'string') {
    throw new Error(`Invalid ${label}`);
  }
  if (path.isAbsolute(segment)) {
    throw new Error(`Path traversal detected — absolute ${label} denied`);
  }
  const normalized = path.normalize(segment);
  if (
    normalized === '..' ||
    normalized.startsWith(`..${path.sep}`) ||
    normalized.includes(`${path.sep}..${path.sep}`) ||
    normalized.endsWith(`${path.sep}..`)
  ) {
    throw new Error(`Path traversal detected — invalid ${label}`);
  }
  return normalized;
}

function resolveStoragePath(...segments: string[]): string {
  const root = getStorageRoot();
  const safeSegments = segments.map((s, i) => assertSafeSegment(s, `segment[${i}]`));
  const resolved = path.resolve(root, ...safeSegments);

  if (!isPathInsideRoot(resolved, root)) {
    throw new Error('Path traversal detected — access denied');
  }

  return resolved;
}

export async function ensureStorageDirectories(): Promise<void> {
  const provider = (process.env.STORAGE_PROVIDER || '').trim().toLowerCase();
  if (process.env.NODE_ENV === 'production' && provider !== 'local') {
    // In production with GridFS, no local filesystem storage directories are required
    return;
  }
  try {
    const dirs = [
      resolveStoragePath('documents'),
      resolveStoragePath('versions'),
    ];

    for (const dir of dirs) {
      await fs.mkdir(dir, { recursive: true });
    }
  } catch {
    // Non-blocking in restricted container environments
  }
}

/**
 * Save a document to secure storage.
 * In production or when STORAGE_PROVIDER=mongodb, documents are encrypted before
 * storage and saved exclusively to MongoDB GridFS. Zero plaintext files are written to disk.
 *
 * Local filesystem storage remains available for development only.
 */
export async function saveDocument(
  documentId: string,
  fileName: string,
  buffer: Buffer,
  options?: { mimeType?: string; uploadedBy?: string; classification?: string }
): Promise<{
  storagePath: string;
  absolutePath: string;
  storageFileId?: string;
  storageProvider?: string;
  encryptionAlgorithm?: string;
  encryptionIV?: string;
  authenticationTag?: string;
  encryptedDEK?: string;
}> {
  const safeId = assertSafeSegment(documentId, 'documentId');
  const safeName = safeBaseName(fileName);

  // If MongoDB GridFS is configured / selected, upload encrypted directly to GridFS
  const provider = (process.env.STORAGE_PROVIDER || '').trim().toLowerCase();
  const isMongo = provider === 'mongodb' || (process.env.NODE_ENV === 'production' && provider !== 'local');

  if (isMongo) {
    const { uploadEncryptedFile } = await import('./encrypted-storage');
    const gridFsResult = await uploadEncryptedFile({
      buffer,
      filename: safeName,
      mimeType: options?.mimeType || getMimeType(getFileExtension(safeName)),
      uploadedBy: options?.uploadedBy || 'system',
      classification: options?.classification || 'INTERNAL',
      documentId: safeId,
    });

    // In production GridFS storage: do NOT write plaintext files to local disk
    const storagePath = `gridfs://${gridFsResult.storageFileId}`;
    return {
      storagePath,
      absolutePath: storagePath,
      storageFileId: gridFsResult.storageFileId,
      storageProvider: gridFsResult.storageProvider,
      encryptionAlgorithm: gridFsResult.encryptionAlgorithm,
      encryptionIV: gridFsResult.encryptionIV,
      authenticationTag: gridFsResult.authenticationTag,
      encryptedDEK: gridFsResult.encryptedDEK,
    };
  }

  // Development-only fallback: local filesystem storage
  const dir = resolveStoragePath('documents', safeId);
  await fs.mkdir(dir, { recursive: true });

  // Atomic write: write to a temporary file first, then atomically rename
  const tempName = `.upload_${Date.now()}_${Math.random().toString(36).slice(2)}.tmp`;
  const tempPath = resolveStoragePath('documents', safeId, tempName);
  const absolutePath = resolveStoragePath('documents', safeId, safeName);

  try {
    await fs.writeFile(tempPath, buffer);
    await fs.rename(tempPath, absolutePath);
  } catch (writeErr) {
    try {
      await fs.unlink(tempPath);
    } catch {}
    throw writeErr;
  }

  const storagePath = path.join('documents', safeId, safeName);
  return {
    storagePath,
    absolutePath,
    storageFileId: undefined,
    storageProvider: 'local',
  };
}

export async function readDocument(
  storagePath: string,
  encryptionMeta?: {
    encryptedDEK?: string | null;
    encryptionIV?: string | null;
    authenticationTag?: string | null;
    storageFileId?: string | null;
  }
): Promise<Buffer> {
  if (storagePath.startsWith('gridfs://') || encryptionMeta?.storageFileId) {
    const fileId = encryptionMeta?.storageFileId || storagePath.replace('gridfs://', '');
    const { downloadDecryptedFile } = await import('./encrypted-storage');

    // If metadata was supplied directly, use it
    if (encryptionMeta?.encryptedDEK && encryptionMeta?.encryptionIV && encryptionMeta?.authenticationTag) {
      return downloadDecryptedFile({
        storageFileId: fileId,
        encryptedDEK: encryptionMeta.encryptedDEK,
        encryptionIV: encryptionMeta.encryptionIV,
        authenticationTag: encryptionMeta.authenticationTag,
      });
    }

    // Otherwise, query Prisma for Document or DocumentVersion metadata
    const { prisma } = await import('@/lib/prisma');
    const doc = await prisma.document.findFirst({
      where: {
        OR: [{ storageFileId: fileId }, { storagePath }],
      },
      select: {
        storageFileId: true,
        encryptedDEK: true,
        encryptionIV: true,
        authenticationTag: true,
      },
    });

    if (doc && doc.storageFileId && doc.encryptedDEK && doc.encryptionIV && doc.authenticationTag) {
      return downloadDecryptedFile({
        storageFileId: doc.storageFileId,
        encryptedDEK: doc.encryptedDEK,
        encryptionIV: doc.encryptionIV,
        authenticationTag: doc.authenticationTag,
      });
    }

    // Try DocumentVersion
    const ver = await prisma.documentVersion.findFirst({
      where: {
        OR: [{ storageFileId: fileId }, { storagePath }],
      },
      select: {
        storageFileId: true,
        encryptedDEK: true,
        encryptionIV: true,
        authenticationTag: true,
      },
    });

    if (ver && ver.storageFileId && ver.encryptedDEK && ver.encryptionIV && ver.authenticationTag) {
      return downloadDecryptedFile({
        storageFileId: ver.storageFileId,
        encryptedDEK: ver.encryptedDEK,
        encryptionIV: ver.encryptionIV,
        authenticationTag: ver.authenticationTag,
      });
    }

    throw new Error('Encryption metadata not found for GridFS document: failed closed');
  }

  const absolutePath = resolveStoragePath(storagePath);
  return fs.readFile(absolutePath);
}

/**
 * Returns a decrypted Readable stream for a document.
 *
 * SECURITY: For GridFS documents the ciphertext is downloaded, AES-256-GCM
 * authentication verified, and plaintext returned as a Readable stream.
 * Raw ciphertext is NEVER forwarded to the caller.
 *
 * File size is bounded by MAX_STREAM_BYTES (100 MiB) to prevent OOM.
 * For larger files, callers should use chunked/paginated streaming.
 *
 * @param encryptionMeta  Required for GridFS documents; must include encryptedDEK,
 *                        encryptionIV, and authenticationTag.
 */
export async function getDocumentStream(
  storagePath: string,
  encryptionMeta?: {
    encryptedDEK?: string | null;
    encryptionIV?: string | null;
    authenticationTag?: string | null;
    storageFileId?: string | null;
  }
): Promise<NodeJS.ReadableStream> {
  const MAX_STREAM_BYTES = 100 * 1024 * 1024; // 100 MiB hard limit

  if (storagePath.startsWith('gridfs://') || encryptionMeta?.storageFileId) {
    const fileId = encryptionMeta?.storageFileId || storagePath.replace('gridfs://', '');

    // Resolve encryption metadata if not supplied directly
    let meta = encryptionMeta;
    if (!meta?.encryptedDEK || !meta?.encryptionIV || !meta?.authenticationTag) {
      const { prisma } = await import('@/lib/prisma');
      const doc = await prisma.document.findFirst({
        where: { OR: [{ storageFileId: fileId }, { storagePath }] },
        select: { storageFileId: true, encryptedDEK: true, encryptionIV: true, authenticationTag: true },
      });
      if (doc) {
        meta = { storageFileId: doc.storageFileId, encryptedDEK: doc.encryptedDEK, encryptionIV: doc.encryptionIV, authenticationTag: doc.authenticationTag };
      } else {
        const ver = await prisma.documentVersion.findFirst({
          where: { OR: [{ storageFileId: fileId }, { storagePath }] },
          select: { storageFileId: true, encryptedDEK: true, encryptionIV: true, authenticationTag: true },
        });
        if (ver) {
          meta = { storageFileId: ver.storageFileId, encryptedDEK: ver.encryptedDEK, encryptionIV: ver.encryptionIV, authenticationTag: ver.authenticationTag };
        }
      }
    }

    if (!meta?.encryptedDEK || !meta?.encryptionIV || !meta?.authenticationTag) {
      throw new Error('Encryption metadata required for GridFS streaming — cannot return unauthenticated data (fail-closed)');
    }

    // Download ciphertext into memory, verify AES-GCM auth tag, then stream plaintext
    // AES-256-GCM requires the entire ciphertext to authenticate before any plaintext
    // is released — true streaming decryption without full buffering is unsafe with GCM.
    const { downloadDecryptedFile } = await import('./encrypted-storage');
    const plaintextBuffer = await downloadDecryptedFile({
      storageFileId: fileId,
      encryptedDEK: meta.encryptedDEK,
      encryptionIV: meta.encryptionIV,
      authenticationTag: meta.authenticationTag,
    });

    if (plaintextBuffer.length > MAX_STREAM_BYTES) {
      throw new Error(`Decrypted document size (${plaintextBuffer.length} bytes) exceeds stream limit of ${MAX_STREAM_BYTES} bytes`);
    }

    const { Readable } = await import('stream');
    const readable = new Readable();
    readable.push(plaintextBuffer);
    readable.push(null);
    return readable;
  }

  const absolutePath = resolveStoragePath(storagePath);
  await fs.access(absolutePath);

  const { createReadStream } = await import('fs');
  return createReadStream(absolutePath);
}

export async function getDocumentStats(storagePath: string): Promise<{ size: number; mtime: Date }> {
  if (storagePath.startsWith('gridfs://')) {
    const fileId = storagePath.replace('gridfs://', '');
    const { getStorageProvider } = await import('./storage-provider');
    const provider = getStorageProvider();
    const info = await provider.getFileInfo(fileId);
    if (!info) {
      throw new Error(`Storage file not found in GridFS: ${fileId}`);
    }
    return {
      size: info.length,
      mtime: info.uploadDate,
    };
  }

  const absolutePath = resolveStoragePath(storagePath);
  const stat = await fs.stat(absolutePath);
  return {
    size: stat.size,
    mtime: stat.mtime,
  };
}

export async function saveVersion(
  documentId: string,
  versionNumber: number,
  fileExtension: string,
  buffer: Buffer,
  options?: { mimeType?: string; uploadedBy?: string }
): Promise<{
  storagePath: string;
  fileSize: number;
  storageFileId?: string;
  storageProvider?: string;
  encryptionAlgorithm?: string;
  encryptionIV?: string;
  authenticationTag?: string;
  encryptedDEK?: string;
}> {
  const safeId = assertSafeSegment(documentId, 'documentId');
  const safeExt = safeBaseName(fileExtension.replace(/^\./, '') || 'bin');
  const versionFileName = `${versionNumber}.${safeExt}`;

  const provider = (process.env.STORAGE_PROVIDER || '').trim().toLowerCase();
  const isMongo = provider === 'mongodb' || (process.env.NODE_ENV === 'production' && provider !== 'local');

  if (isMongo) {
    const { uploadEncryptedFile } = await import('./encrypted-storage');
    const gridFsResult = await uploadEncryptedFile({
      buffer,
      filename: versionFileName,
      mimeType: options?.mimeType || getMimeType(safeExt),
      uploadedBy: options?.uploadedBy || 'system',
      documentId: safeId,
      version: versionNumber,
    });

    const storagePath = `gridfs://${gridFsResult.storageFileId}`;
    return {
      storagePath,
      fileSize: buffer.length,
      storageFileId: gridFsResult.storageFileId,
      storageProvider: gridFsResult.storageProvider,
      encryptionAlgorithm: gridFsResult.encryptionAlgorithm,
      encryptionIV: gridFsResult.encryptionIV,
      authenticationTag: gridFsResult.authenticationTag,
      encryptedDEK: gridFsResult.encryptedDEK,
    };
  }

  const dir = resolveStoragePath('versions', safeId);
  await fs.mkdir(dir, { recursive: true });

  const absolutePath = resolveStoragePath('versions', safeId, versionFileName);
  await fs.writeFile(absolutePath, buffer);

  const storagePath = path.join('versions', safeId, versionFileName);
  return { storagePath, fileSize: buffer.length, storageProvider: 'local' };
}

export async function readVersion(
  storagePath: string,
  encryptionMeta?: {
    encryptedDEK?: string | null;
    encryptionIV?: string | null;
    authenticationTag?: string | null;
    storageFileId?: string | null;
  }
): Promise<Buffer> {
  return readDocument(storagePath, encryptionMeta);
}

export async function deleteDocumentFiles(documentId: string): Promise<void> {
  const safeId = assertSafeSegment(documentId, 'documentId');

  // Local directory cleanup (best-effort)
  try {
    const docDir = resolveStoragePath('documents', safeId);
    const verDir = resolveStoragePath('versions', safeId);
    await fs.rm(docDir, { recursive: true, force: true }).catch(() => {});
    await fs.rm(verDir, { recursive: true, force: true }).catch(() => {});
  } catch {}

  // Clean up any MongoDB GridFS file referenced by this document
  try {
    const { prisma } = await import('@/lib/prisma');
    const doc = await prisma.document.findUnique({
      where: { id: safeId },
      select: { storageFileId: true, versions: { select: { storageFileId: true } } },
    });
    if (doc) {
      const { getStorageProvider } = await import('./storage-provider');
      const provider = getStorageProvider();
      if (doc.storageFileId) {
        await provider.delete(doc.storageFileId).catch(() => {});
      }
      for (const v of doc.versions) {
        if (v.storageFileId) {
          await provider.delete(v.storageFileId).catch(() => {});
        }
      }
    }
  } catch {
    // Non-blocking
  }
}

const MIME_MAP: Record<string, string> = {
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  doc: 'application/msword',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  xls: 'application/vnd.ms-excel',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  ppt: 'application/vnd.ms-powerpoint',
  pdf: 'application/pdf',
  odt: 'application/vnd.oasis.opendocument.text',
  ods: 'application/vnd.oasis.opendocument.spreadsheet',
  odp: 'application/vnd.oasis.opendocument.presentation',
  csv: 'text/csv',
  txt: 'text/plain',
  rtf: 'application/rtf',
};

export function getMimeType(fileExtension: string): string {
  return MIME_MAP[fileExtension.toLowerCase()] || 'application/octet-stream';
}

export function getFileExtension(fileName: string): string {
  const ext = path.extname(fileName).slice(1).toLowerCase();
  return ext || 'bin';
}
