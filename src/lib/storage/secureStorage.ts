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

const STORAGE_ROOT = process.env.SECURE_STORAGE_PATH || './secure-storage';

// ─── Helper: resolve absolute path from storage root ────────────────
function resolveStoragePath(...segments: string[]): string {
  const resolved = path.resolve(STORAGE_ROOT, ...segments);

  // Prevent path traversal attacks
  const root = path.resolve(STORAGE_ROOT);
  if (!resolved.startsWith(root)) {
    throw new Error('Path traversal detected — access denied');
  }

  return resolved;
}

// ─── Ensure base directories exist ──────────────────────────────────
export async function ensureStorageDirectories(): Promise<void> {
  const dirs = [
    resolveStoragePath('documents'),
    resolveStoragePath('versions'),
  ];

  for (const dir of dirs) {
    await fs.mkdir(dir, { recursive: true });
  }
}

// ─── Document I/O ───────────────────────────────────────────────────

/**
 * Save a document to secure storage.
 * Returns the relative storage path (stored in the DB — NOT the absolute path).
 */
export async function saveDocument(
  documentId: string,
  fileName: string,
  buffer: Buffer
): Promise<{ storagePath: string; absolutePath: string }> {
  const dir = resolveStoragePath('documents', documentId);
  await fs.mkdir(dir, { recursive: true });

  const absolutePath = path.join(dir, fileName);
  await fs.writeFile(absolutePath, buffer);

  // Return the relative path for database storage
  const storagePath = path.join('documents', documentId, fileName);
  return { storagePath, absolutePath };
}

/**
 * Read a document from secure storage.
 * Accepts the relative storagePath from the database.
 */
export async function readDocument(storagePath: string): Promise<Buffer> {
  const absolutePath = resolveStoragePath(storagePath);
  return fs.readFile(absolutePath);
}

/**
 * Read a document as a readable stream (for efficient HTTP streaming).
 */
export async function getDocumentStream(storagePath: string) {
  const absolutePath = resolveStoragePath(storagePath);
  // Verify file exists before streaming
  await fs.access(absolutePath);

  const { createReadStream } = await import('fs');
  return createReadStream(absolutePath);
}

/**
 * Get file stats (size, modified date, etc.)
 */
export async function getDocumentStats(storagePath: string) {
  const absolutePath = resolveStoragePath(storagePath);
  return fs.stat(absolutePath);
}

// ─── Version Management ─────────────────────────────────────────────

/**
 * Save a previous version of a document before overwriting it.
 * Returns the relative path to the version file.
 */
export async function saveVersion(
  documentId: string,
  versionNumber: number,
  fileExtension: string,
  buffer: Buffer
): Promise<{ storagePath: string; fileSize: number }> {
  const dir = resolveStoragePath('versions', documentId);
  await fs.mkdir(dir, { recursive: true });

  const versionFileName = `${versionNumber}.${fileExtension}`;
  const absolutePath = path.join(dir, versionFileName);
  await fs.writeFile(absolutePath, buffer);

  const storagePath = path.join('versions', documentId, versionFileName);
  return { storagePath, fileSize: buffer.length };
}

/**
 * Read a specific version of a document.
 */
export async function readVersion(storagePath: string): Promise<Buffer> {
  const absolutePath = resolveStoragePath(storagePath);
  return fs.readFile(absolutePath);
}

// ─── Deletion ───────────────────────────────────────────────────────

/**
 * Securely delete a document and all its versions from disk.
 */
export async function deleteDocumentFiles(documentId: string): Promise<void> {
  const docDir = resolveStoragePath('documents', documentId);
  const verDir = resolveStoragePath('versions', documentId);

  // Remove directories recursively (safe — already validated path)
  await fs.rm(docDir, { recursive: true, force: true });
  await fs.rm(verDir, { recursive: true, force: true });
}

// ─── MIME type helpers ──────────────────────────────────────────────

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

/**
 * Extract file extension from a filename (without the dot).
 */
export function getFileExtension(fileName: string): string {
  const ext = path.extname(fileName).slice(1).toLowerCase();
  return ext || 'bin';
}
