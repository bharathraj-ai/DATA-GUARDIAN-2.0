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

function getStorageRoot(): string {
  return path.resolve(STORAGE_ROOT);
}

/** True if resolved path is exactly root or a path under root (sep-safe). */
function isPathInsideRoot(resolved: string, root: string): boolean {
  const normalizedRoot = root.endsWith(path.sep) ? root.slice(0, -1) : root;
  return resolved === normalizedRoot || resolved.startsWith(normalizedRoot + path.sep);
}

/** Reject path segments that could escape (absolute, .., empty). */
function assertSafeSegment(segment: string, label: string): string {
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

/** Basename-only filename (no directories). */
function safeBaseName(fileName: string): string {
  if (!fileName || /[/\\]/.test(fileName)) {
    throw new Error('Path traversal detected — file name must be basename only');
  }
  const base = path.basename(fileName);
  if (!base || base === '.' || base === '..') {
    throw new Error('Invalid file name');
  }
  return base;
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
  const dirs = [
    resolveStoragePath('documents'),
    resolveStoragePath('versions'),
  ];

  for (const dir of dirs) {
    await fs.mkdir(dir, { recursive: true });
  }
}

/**
 * Save a document to secure storage.
 * Returns the relative storage path (stored in the DB — NOT the absolute path).
 */
export async function saveDocument(
  documentId: string,
  fileName: string,
  buffer: Buffer
): Promise<{ storagePath: string; absolutePath: string }> {
  const safeId = assertSafeSegment(documentId, 'documentId');
  const safeName = safeBaseName(fileName);

  const dir = resolveStoragePath('documents', safeId);
  await fs.mkdir(dir, { recursive: true });

  const absolutePath = resolveStoragePath('documents', safeId, safeName);
  await fs.writeFile(absolutePath, buffer);

  const storagePath = path.join('documents', safeId, safeName);
  return { storagePath, absolutePath };
}

export async function readDocument(storagePath: string): Promise<Buffer> {
  const absolutePath = resolveStoragePath(storagePath);
  return fs.readFile(absolutePath);
}

export async function getDocumentStream(storagePath: string) {
  const absolutePath = resolveStoragePath(storagePath);
  await fs.access(absolutePath);

  const { createReadStream } = await import('fs');
  return createReadStream(absolutePath);
}

export async function getDocumentStats(storagePath: string) {
  const absolutePath = resolveStoragePath(storagePath);
  return fs.stat(absolutePath);
}

export async function saveVersion(
  documentId: string,
  versionNumber: number,
  fileExtension: string,
  buffer: Buffer
): Promise<{ storagePath: string; fileSize: number }> {
  const safeId = assertSafeSegment(documentId, 'documentId');
  const safeExt = safeBaseName(fileExtension.replace(/^\./, '') || 'bin');

  const dir = resolveStoragePath('versions', safeId);
  await fs.mkdir(dir, { recursive: true });

  const versionFileName = `${versionNumber}.${safeExt}`;
  const absolutePath = resolveStoragePath('versions', safeId, versionFileName);
  await fs.writeFile(absolutePath, buffer);

  const storagePath = path.join('versions', safeId, versionFileName);
  return { storagePath, fileSize: buffer.length };
}

export async function readVersion(storagePath: string): Promise<Buffer> {
  const absolutePath = resolveStoragePath(storagePath);
  return fs.readFile(absolutePath);
}

export async function deleteDocumentFiles(documentId: string): Promise<void> {
  const safeId = assertSafeSegment(documentId, 'documentId');
  const docDir = resolveStoragePath('documents', safeId);
  const verDir = resolveStoragePath('versions', safeId);

  await fs.rm(docDir, { recursive: true, force: true });
  await fs.rm(verDir, { recursive: true, force: true });
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
