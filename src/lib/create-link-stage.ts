import 'server-only';

import path from 'path';
import { ObjectId } from 'mongodb';
import { encryptBuffer, generateDek } from '@/lib/crypto';
import { ALLOWED_EXTENSIONS, validateMimeType } from '@/lib/security/file-validator';
import { getMongoDb, withMongoRetry } from '@/lib/mongo/client';

export const LINK_STAGING_FOLDER = 'link-staging';
export const MAX_SINGLE_FILE_SIZE = 15 * 1024 * 1024;
export const MAX_FILES = 50;
export const MAX_TOTAL_SIZE = 100 * 1024 * 1024;

const OBJECT_ID_RE = /^[a-f0-9]{24}$/i;

export type PreparedLinkFile = {
    gridFSId: string;
    fileName: string;
    fileType: string;
    fileSize: number;
    fileExtension: string;
    checksum: string;
    iv: string;
    authTag: string;
    encryptedDek: string;
    scanStatus: string;
};

export function assertSafeUploadName(fileName: string): string {
    if (!fileName || fileName.includes('\0')) {
        throw new Error('Invalid filename.');
    }
    const sanitizedName = path.basename(fileName).substring(0, 255);
    const nameParts = sanitizedName.split('.');
    if (nameParts.length > 2) {
        for (let i = 1; i < nameParts.length - 1; i++) {
            const intermediateExt = '.' + nameParts[i].toLowerCase();
            if (ALLOWED_EXTENSIONS.has(intermediateExt)) {
                throw new Error(
                    `File "${sanitizedName}" has a suspicious double extension. Rename the file and try again.`,
                );
            }
        }
    }
    const ext = path.extname(sanitizedName).toLowerCase();
    if (!ALLOWED_EXTENSIONS.has(ext)) {
        throw new Error(
            `File "${sanitizedName}": type "${ext}" is not allowed. Permitted: Word, PDF, Excel, CSV, Images, Text.`,
        );
    }
    return sanitizedName;
}

export async function stagePlainFile(params: {
    buffer: Buffer;
    fileName: string;
    uploadedBy: string;
}): Promise<PreparedLinkFile> {
    if (params.buffer.length > MAX_SINGLE_FILE_SIZE) {
        throw new Error(`File "${params.fileName}" exceeds 15MB limit.`);
    }
    const sanitizedName = assertSafeUploadName(params.fileName);
    const ext = path.extname(sanitizedName).toLowerCase();
    const mimeCheck = validateMimeType(params.buffer.subarray(0, 4100), ext);
    if (!mimeCheck.valid) {
        throw new Error(`File "${sanitizedName}": ${mimeCheck.error}`);
    }
    const trustedMimeType = mimeCheck.mimeType!;
    const { scanUploadBuffer, assertScanAllowed } = await import('@/lib/security/malware-scan');
    const scan = await scanUploadBuffer(params.buffer, sanitizedName);
    assertScanAllowed(scan, sanitizedName);

    const dek = generateDek();
    const { iv, authTag, encryptedContent } = encryptBuffer(params.buffer, dek);
    const { wrapDek, kmsHttpEnabled } = await import('@/lib/security/kms');
    let keyId: string | null = null;
    if (kmsHttpEnabled()) {
        const { kmsKeyIdForUser } = await import('@/lib/tenant');
        keyId = await kmsKeyIdForUser(params.uploadedBy);
    }
    const encryptedDek = await wrapDek(dek, keyId);

    const { putStagedCiphertext } = await import('@/lib/blob-store');
    const uploaded = await putStagedCiphertext(encryptedContent, {
        originalFileName: sanitizedName,
        mimeType: trustedMimeType,
        fileExtension: ext.replace('.', ''),
        iv,
        authTag,
        encryptedDek,
        uploadedBy: params.uploadedBy,
        scanStatus: scan.status,
    });

    return {
        gridFSId: uploaded.pointer,
        fileName: sanitizedName,
        fileType: trustedMimeType,
        fileSize: uploaded.fileSize,
        fileExtension: ext.replace('.', ''),
        checksum: uploaded.checksum,
        iv,
        authTag,
        encryptedDek,
        scanStatus: scan.status,
    };
}

export async function loadStagedFiles(
    userId: string,
    gridFSIds: string[],
): Promise<PreparedLinkFile[]> {
    if (gridFSIds.length === 0) return [];
    if (gridFSIds.length > MAX_FILES) {
        throw new Error(`Too many files. Maximum ${MAX_FILES} files allowed.`);
    }
    const unique = [...new Set(gridFSIds)];

    if (unique.some((id) => !OBJECT_ID_RE.test(id))) {
        throw new Error('Invalid staged file id.');
    }

    const docs = await withMongoRetry(async () => {
        const db = await getMongoDb();
        return db
            .collection('uploads.files')
            .find({
                _id: { $in: unique.map((id) => new ObjectId(id)) },
                'metadata.uploadedBy': userId,
                'metadata.folder': LINK_STAGING_FOLDER,
            })
            .toArray();
    });

    if (docs.length !== unique.length) {
        throw new Error('One or more files are not ready. Remove them and attach again.');
    }

    const byId = new Map(docs.map((doc) => [String(doc._id), doc]));
    return unique.map((id) => {
        const doc = byId.get(id)!;
        const meta = (doc.metadata || {}) as Record<string, string>;
        if (!meta.iv || !meta.authTag || !meta.encryptedDek) {
            throw new Error('Staged file is missing encryption metadata. Attach the file again.');
        }
        return {
            gridFSId: id,
            fileName: String(meta.originalFileName || doc.filename || 'file'),
            fileType: String(meta.mimeType || 'application/octet-stream'),
            fileSize: Number(doc.length || 0),
            fileExtension: String(meta.fileExtension || ''),
            checksum: String(meta.checksum || ''),
            iv: meta.iv,
            authTag: meta.authTag,
            encryptedDek: meta.encryptedDek,
            scanStatus: String(meta.scanStatus || 'pending'),
        };
    });
}

export async function markStagedFilesLinked(gridFSIds: string[]): Promise<string[]> {
    if (gridFSIds.length === 0) return [];
    await withMongoRetry(async () => {
        const db = await getMongoDb();
        await db.collection('uploads.files').updateMany(
            { _id: { $in: gridFSIds.filter((id) => OBJECT_ID_RE.test(id)).map((id) => new ObjectId(id)) } },
            { $set: { 'metadata.folder': 'vendor-uploads' } },
        );
    });
    return gridFSIds;
}

export const STAGING_MAX_AGE_MS = 24 * 60 * 60 * 1000;

/**
 * Delete GridFS objects left in `link-staging` after an aborted create-link.
 * Linked files are moved to `vendor-uploads` and are not touched.
 */
export async function reapStaleStagedFiles(options?: {
    maxAgeMs?: number;
    limit?: number;
}): Promise<number> {
    const { isMongoConfigured } = await import('@/lib/mongo/client');
    if (!isMongoConfigured()) return 0;

    const maxAgeMs = options?.maxAgeMs ?? STAGING_MAX_AGE_MS;
    const limit = Math.min(500, Math.max(1, options?.limit ?? 100));
    const cutoff = new Date(Date.now() - maxAgeMs);

    const stale = await withMongoRetry(async () => {
        const db = await getMongoDb();
        return db
            .collection('uploads.files')
            .find({
                'metadata.folder': LINK_STAGING_FOLDER,
                uploadDate: { $lt: cutoff },
            })
            .project({ _id: 1 })
            .limit(limit)
            .toArray();
    });

    if (stale.length === 0) return 0;

    const { deleteFromMongo } = await import('@/lib/mongo/operations');
    const results = await Promise.allSettled(
        stale.map((doc) => deleteFromMongo(String(doc._id))),
    );
    return results.filter((r) => r.status === 'fulfilled').length;
}
