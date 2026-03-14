/**
 * Data Guardian 2.0 — Encryption Service
 *
 * Typed wrappers around the existing crypto.ts helpers for use by the
 * streaming / save APIs and the collaboration engine.
 */

import { encryptBuffer as _encryptBuffer, decryptBuffer as _decryptBuffer } from './crypto';

export interface EncryptedBlob {
  encryptedContent: Buffer;
  iv: string;      // hex
  authTag: string; // hex
}

/**
 * Encrypt arbitrary bytes (file content, snapshots, etc.)
 * Uses AES-256-GCM with a random IV per call (key sourced from ENCRYPTION_KEY env).
 */
export function encryptBytes(data: Buffer | Uint8Array): EncryptedBlob {
  const buf = Buffer.isBuffer(data) ? data : Buffer.from(data);
  return _encryptBuffer(buf);
}

/**
 * Decrypt AES-256-GCM ciphertext back to raw bytes.
 */
export function decryptBytes(blob: {
  encryptedContent: Buffer | Uint8Array;
  iv: string;
  authTag: string;
}): Buffer {
  const content = Buffer.isBuffer(blob.encryptedContent)
    ? blob.encryptedContent
    : Buffer.from(blob.encryptedContent);
  return _decryptBuffer(content, blob.iv, blob.authTag);
}

/**
 * Encode raw bytes to a safe base64 data-URL string for memory-only transfer
 * inside the browser (never written to disk).
 */
export function bytesToDataUrl(bytes: Buffer, mimeType: string): string {
  const b64 = bytes.toString('base64');
  return `data:${mimeType};base64,${b64}`;
}

/**
 * Decode a base64 data-URL back to a Buffer.
 */
export function dataUrlToBytes(dataUrl: string): Buffer {
  const idx = dataUrl.indexOf(',');
  const b64 = idx >= 0 ? dataUrl.slice(idx + 1) : dataUrl;
  return Buffer.from(b64, 'base64');
}
