/**
 * Ciphertext object store backed by MongoDB GridFS.
 * Keys: `gridfs:<24-hex>`. MongoFile.gridFSId stores the raw GridFS ObjectId.
 */
import 'server-only';

import crypto from 'crypto';
import { isMongoConfigured } from '@/lib/mongo/client';

export const VERSION_FOLDER = 'file-versions';
export const DRAFT_FOLDER = 'file-drafts';
export const STAGING_FOLDER = 'link-staging';
export const LIVE_FOLDER = 'vendor-uploads';
export const FINAL_FOLDER = 'final-submissions';

const GRIDFS_PREFIX = 'gridfs:';
const OBJECT_ID_RE = /^[a-f0-9]{24}$/i;
const SAFE_FOLDER = /^(link-staging|vendor-uploads|file-versions|file-drafts|final-submissions)$/;

export type StagedBlobMeta = {
    originalFileName: string;
    mimeType: string;
    fileExtension: string;
    checksum: string;
    iv: string;
    authTag: string;
    encryptedDek: string;
    uploadedBy: string;
    folder: string;
    scanStatus: string;
    fileSize: number;
};

export function blobStoreEnabled(): boolean {
    if (process.env.NODE_ENV === 'test' && process.env.FORCE_BLOB_STORE !== '1') {
        return false;
    }
    return isMongoConfigured();
}

export function gridFsIdFromStorageKey(storageKey: string | null | undefined): string | null {
    if (!storageKey || !storageKey.startsWith(GRIDFS_PREFIX)) return null;
    const id = storageKey.slice(GRIDFS_PREFIX.length).trim();
    return OBJECT_ID_RE.test(id) ? id : null;
}

export function storageKeyForGridFs(gridFSId: string): string {
    return `${GRIDFS_PREFIX}${gridFSId}`;
}

/** Normalize a MongoFile.gridFSId (ObjectId or gridfs:…) to a storage key. */
export function storageKeyForPointer(pointer: string | null | undefined): string | null {
    if (!pointer) return null;
    if (pointer.startsWith(GRIDFS_PREFIX)) {
        return gridFsIdFromStorageKey(pointer) ? pointer : null;
    }
    if (OBJECT_ID_RE.test(pointer)) return storageKeyForGridFs(pointer);
    return null;
}

function checksumOf(buffer: Buffer): string {
    return crypto.createHash('sha256').update(buffer).digest('hex');
}

function assertFolder(folder: string): string {
    if (!SAFE_FOLDER.test(folder)) {
        throw new Error('Invalid object-store folder');
    }
    return folder;
}

export async function putCiphertext(
    buffer: Buffer,
    options: { fileName: string; uploadedBy?: string; folder?: string },
): Promise<string | null> {
    if (!blobStoreEnabled() || buffer.length === 0) return null;

    const { uploadToMongo } = await import('@/lib/mongo/operations');
    const uploaded = await uploadToMongo({
        buffer,
        originalFileName: options.fileName.slice(0, 255) || 'ciphertext.bin',
        mimeType: 'application/octet-stream',
        fileExtension: 'bin',
        folder: assertFolder(options.folder ?? VERSION_FOLDER),
        uploadedBy: options.uploadedBy || 'system',
        classification: 'RESTRICTED',
    });
    return storageKeyForGridFs(uploaded.gridFSId);
}

export async function getCiphertext(storageKey: string, expectedSize?: number): Promise<Buffer> {
    const gridFSId = gridFsIdFromStorageKey(storageKey);
    if (!gridFSId) {
        throw new Error('Unsupported storage key');
    }
    const { downloadFromMongo } = await import('@/lib/mongo/operations');
    return downloadFromMongo(gridFSId, expectedSize);
}

export async function deleteCiphertext(storageKey: string): Promise<void> {
    const gridFSId = gridFsIdFromStorageKey(storageKey);
    if (!gridFSId) return;
    const { deleteFromMongo } = await import('@/lib/mongo/operations');
    await deleteFromMongo(gridFSId);
}

export async function deleteCiphertexts(storageKeys: Array<string | null | undefined>): Promise<void> {
    const keys = [...new Set(storageKeys.filter((k): k is string => Boolean(k)))];
    await Promise.allSettled(keys.map((key) => deleteCiphertext(key)));
}

/** Download live ciphertext from MongoFile.gridFSId. */
export async function downloadLiveObject(pointer: string, expectedSize?: number): Promise<Buffer> {
    const key = storageKeyForPointer(pointer);
    if (key) return getCiphertext(key, expectedSize);
    throw new Error('Unsupported storage pointer');
}

/** Delete live objects referenced by MongoFile.gridFSId. */
export async function deleteLiveObjects(pointers: string[]): Promise<void> {
    const keys = pointers.map((p) => storageKeyForPointer(p)).filter((k): k is string => Boolean(k));
    await deleteCiphertexts(keys);
}

export function mongoPointerFromStorageKey(storageKey: string): string {
    const grid = gridFsIdFromStorageKey(storageKey);
    return grid || storageKey;
}

export async function putStagedCiphertext(
    buffer: Buffer,
    meta: Omit<StagedBlobMeta, 'checksum' | 'fileSize' | 'folder'>,
): Promise<{
    pointer: string;
    checksum: string;
    fileSize: number;
}> {
    if (!isMongoConfigured()) {
        throw new Error('Object storage is not configured (set MONGODB_URI).');
    }
    const checksum = checksumOf(buffer);
    const { uploadToMongo } = await import('@/lib/mongo/operations');
    const uploaded = await uploadToMongo({
        buffer,
        originalFileName: meta.originalFileName,
        mimeType: meta.mimeType,
        fileExtension: meta.fileExtension,
        folder: STAGING_FOLDER,
        uploadedBy: meta.uploadedBy,
        classification: 'INTERNAL',
        extraMetadata: {
            iv: meta.iv,
            authTag: meta.authTag,
            encryptedDek: meta.encryptedDek,
            originalFileName: meta.originalFileName,
            scanStatus: meta.scanStatus,
            checksum,
        },
    });
    return { pointer: uploaded.gridFSId, checksum, fileSize: uploaded.fileSize };
}
