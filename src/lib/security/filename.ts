/**
 * Filename Security Utilities (SV-01)
 *
 * Provides:
 * - Server-side filename sanitization (CRLF, null bytes, control chars, path traversal)
 * - Extension validation and preservation
 * - Strict length enforcement
 * - RFC 6266 / RFC 5987 compliant Content-Disposition header generation
 */

// Characters considered dangerous in filenames across filesystems and protocols
// Includes ASCII 0x00-0x1F, 0x7F-0x9F, and Unicode directional override controls (e.g. \u202E RLO)
const CONTROL_AND_BIDI_CHARS = /[\x00-\x1F\x7F-\x9F\u200E\u200F\u202A-\u202E]/g;

// Characters unsafe for standard filesystem filenames or shell expansion: \ / : * ? " < > | ; $ ` { }
const UNSAFE_FILENAME_CHARS = /[\\/:*?"<>|;$`{}]/g;

export const MAX_FILENAME_BASE_LENGTH = 100;
export const MAX_TOTAL_FILENAME_LENGTH = 255;

export interface SanitizedFilenameResult {
  sanitizedFileName: string;
  extension: string;
  baseName: string;
}

/**
 * Sanitizes a browser-provided filename on the server.
 *
 * Security guarantees:
 * - Never trusts client input
 * - Removes CRLF, null bytes, and all control characters
 * - Strips directory traversal (/ \ ..)
 * - Validates file extension against an allowed set before preservation
 * - Enforces safe length limits
 * - Normalizes to a safe, valid basename
 *
 * @throws Error if extension is missing, invalid, or not in allowedExtensions
 */
export function sanitizeFileName(
  rawName: string | undefined | null,
  allowedExtensions?: Set<string>,
): SanitizedFilenameResult {
  if (!rawName || typeof rawName !== 'string') {
    throw new Error('Filename must be a non-empty string');
  }

  // 1. Remove null bytes (both literal \0 and %00) and CRLF / control / bidi chars
  let cleaned = rawName
    .replace(/%00/gi, '')
    .replace(/\0/g, '')
    .replace(/\r/g, '')
    .replace(/\n/g, '')
    .replace(CONTROL_AND_BIDI_CHARS, '')
    .trim();

  // 2. Prevent path traversal: strip any directory components (both Unix / and Windows \)
  const lastSlashIndex = Math.max(cleaned.lastIndexOf('/'), cleaned.lastIndexOf('\\'));
  if (lastSlashIndex !== -1) {
    cleaned = cleaned.slice(lastSlashIndex + 1).trim();
  }

  // Remove any remaining .. sequences
  cleaned = cleaned.replace(/\.{2,}/g, '.');

  // 3. Extract and validate extension
  const lastDotIndex = cleaned.lastIndexOf('.');
  if (lastDotIndex === -1 || lastDotIndex === cleaned.length - 1) {
    throw new Error('File must have a valid extension');
  }

  const rawExtension = cleaned.slice(lastDotIndex + 1).toLowerCase().trim();
  const rawBaseName = lastDotIndex === 0 ? '' : cleaned.slice(0, lastDotIndex);

  // Validate extension characters: strictly alphanumeric
  if (!/^[a-z0-9]{1,10}$/.test(rawExtension)) {
    throw new Error(`Invalid file extension: '.${rawExtension}'`);
  }

  // Validate extension against allowed whitelist if provided
  if (allowedExtensions && !allowedExtensions.has(rawExtension)) {
    throw new Error(`File type '.${rawExtension}' is not allowed`);
  }

  // 4. Sanitize base name
  let sanitizedBase = rawBaseName
    .replace(UNSAFE_FILENAME_CHARS, '_')
    .replace(/\s+/g, ' ')
    .replace(/[._-]+$/, '') // Trim trailing separators
    .replace(/^[._-]+/, '') // Trim leading separators
    .trim();

  // If base name became empty after stripping malicious characters, use safe fallback
  if (!sanitizedBase) {
    sanitizedBase = 'document';
  }

  // 5. Enforce safe length limit (base <= 100 chars, total <= 255 bytes)
  if (sanitizedBase.length > MAX_FILENAME_BASE_LENGTH) {
    sanitizedBase = sanitizedBase.slice(0, MAX_FILENAME_BASE_LENGTH).trimEnd();
  }

  const sanitizedFileName = `${sanitizedBase}.${rawExtension}`;

  if (sanitizedFileName.length > MAX_TOTAL_FILENAME_LENGTH) {
    throw new Error('Filename exceeds maximum allowed length');
  }

  return {
    sanitizedFileName,
    extension: rawExtension,
    baseName: sanitizedBase,
  };
}

/**
 * Generates an RFC 6266 and RFC 5987 / RFC 8187 compliant Content-Disposition header.
 *
 * Security features:
 * - Completely eliminates CRLF injection (HTTP response splitting)
 * - Safe ASCII fallback in filename="..." (strips quotes, backslashes, non-ASCII)
 * - Proper UTF-8 percent-encoding in filename*=UTF-8''... (encodes quotes, parens, asterisks)
 *
 * @param type 'inline' or 'attachment'
 * @param fileName The filename to encode
 */
export function formatContentDisposition(
  type: 'inline' | 'attachment',
  fileName: string,
): string {
  // 1. Sanitize to strip CRLF, null bytes, and control characters
  const clean = (fileName || 'document')
    .replace(/%00/gi, '')
    .replace(/\0/g, '')
    .replace(/[\r\n\x00-\x1F\x7F-\x9F]/g, '')
    .trim();

  // 2. ASCII fallback: only ASCII printable characters (0x20 - 0x7E), replace " and \ with _
  const asciiFallback = clean
    .replace(/[^\x20-\x7E]/g, '_')
    .replace(/["\\]/g, '_')
    .trim() || 'document';

  // 3. RFC 5987 percent-encoding for UTF-8 filename*
  // encodeURIComponent does not encode ! ' ( ) * ~
  // RFC 5987 attr-char forbids ' ( ) * so we encode them explicitly
  const rfc5987Encoded = encodeURIComponent(clean)
    .replace(/['()*]/g, c => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);

  return `${type}; filename="${asciiFallback}"; filename*=UTF-8''${rfc5987Encoded}`;
}
