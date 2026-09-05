import path from 'path';

/**
 * Path-safety helpers kept for upload-name tests.
 * Plaintext on-disk document storage was removed in Phase 4 (GridFS ciphertext only).
 */

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

export async function saveDocument(
  _documentId: string,
  _fileName: string,
  _buffer: Buffer
): Promise<{ storagePath: string; absolutePath: string }> {
  throw new Error('Plaintext disk storage was removed. Use GridFS ciphertext via create-link.');
}

export async function readDocument(_storagePath: string): Promise<Buffer> {
  throw new Error('Plaintext disk storage was removed.');
}
