/**
 * Optional customer-managed key wrap for per-file DEKs.
 * Default: local KEK_KEY (existing encryptDek / decryptDek).
 * HTTP: POST raw 32-byte DEK to KMS_WRAP_URL; unwrap via KMS_UNWRAP_URL.
 * Stored envelope: kms:http:<base64>
 *
 * The server still unwraps DEKs to serve files — this is not zero-knowledge.
 */
import 'server-only';

import { decryptDek, encryptDek } from '@/lib/crypto';

const HTTP_PREFIX = 'kms:http:';
const WRAP_TIMEOUT_MS = 8_000;

export function kmsHttpEnabled(): boolean {
    return Boolean(process.env.KMS_WRAP_URL?.trim() && process.env.KMS_UNWRAP_URL?.trim());
}

export async function wrapDekForLink(dek: Buffer, linkId?: string | null): Promise<string> {
    if (!kmsHttpEnabled() || !linkId) return wrapDek(dek);
    const { kmsKeyIdForLink } = await import('@/lib/tenant');
    return wrapDek(dek, await kmsKeyIdForLink(linkId));
}

export async function wrapDek(dek: Buffer, keyId?: string | null): Promise<string> {
    const wrapUrl = process.env.KMS_WRAP_URL?.trim();
    if (!wrapUrl) return encryptDek(dek);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), WRAP_TIMEOUT_MS);
    try {
        const res = await fetch(wrapUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/octet-stream',
                ...(process.env.KMS_TOKEN ? { Authorization: `Bearer ${process.env.KMS_TOKEN}` } : {}),
                ...(keyId ? { 'X-Kms-Key-Id': keyId } : {}),
            },
            body: new Uint8Array(dek),
            signal: controller.signal,
        });
        if (!res.ok) {
            throw new Error(`KMS wrap failed HTTP ${res.status}`);
        }
        const json = (await res.json().catch(() => ({}))) as { wrapped?: string };
        if (!json.wrapped) {
            throw new Error('KMS wrap response missing wrapped');
        }
        return `${HTTP_PREFIX}${json.wrapped}`;
    } finally {
        clearTimeout(timer);
    }
}

export async function unwrapDek(encryptedDekString: string): Promise<Buffer> {
    if (!encryptedDekString.startsWith(HTTP_PREFIX)) {
        return decryptDek(encryptedDekString);
    }

    const unwrapUrl = process.env.KMS_UNWRAP_URL?.trim();
    if (!unwrapUrl) {
        throw new Error('KMS-wrapped DEK but KMS_UNWRAP_URL is not set');
    }

    const wrapped = encryptedDekString.slice(HTTP_PREFIX.length);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), WRAP_TIMEOUT_MS);
    try {
        const res = await fetch(unwrapUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                ...(process.env.KMS_TOKEN ? { Authorization: `Bearer ${process.env.KMS_TOKEN}` } : {}),
            },
            body: JSON.stringify({ wrapped }),
            signal: controller.signal,
        });
        if (!res.ok) {
            throw new Error(`KMS unwrap failed HTTP ${res.status}`);
        }
        const buf = Buffer.from(await res.arrayBuffer());
        if (buf.length === 32) return buf;
        const json = JSON.parse(buf.toString('utf8')) as { dek?: string };
        if (!json.dek) throw new Error('KMS unwrap response missing dek');
        return Buffer.from(json.dek, 'base64');
    } finally {
        clearTimeout(timer);
    }
}
