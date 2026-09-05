/**
 * FileVersion rows store metadata + a blob storageKey.
 * Ciphertext must not be copied into Postgres BYTEA when object storage is available.
 */
import 'server-only';

import { prisma } from '@/lib/prisma';
import { gridFsIdForFile, type UserFileContentRow } from '@/lib/security/resource-ownership';
import crypto from 'crypto';
import {
    blobStoreEnabled,
    deleteCiphertexts,
    getCiphertext,
    putCiphertext,
    mongoPointerFromStorageKey,
    storageKeyForPointer,
    VERSION_FOLDER,
    DRAFT_FOLDER,
} from '@/lib/blob-store';

const MAX_VERSIONS = 10;

export type LiveCipherFile = UserFileContentRow & {
    id: string;
    fileName?: string | null;
    fileType?: string | null;
    encryptedContent?: Buffer | Uint8Array | null;
    iv?: string | null;
    authTag?: string | null;
    encryptedDek?: string | null;
    fileSize?: number | null;
    mongoFileId?: string | null;
};

export type VersionCipherRow = {
    encryptedContent?: Buffer | Uint8Array | null;
    storageKey?: string | null;
    fileSize?: number | null;
};

function asBuffer(data: Buffer | Uint8Array): Buffer {
    return Buffer.isBuffer(data) ? data : Buffer.from(data);
}

export async function resolveLiveCiphertext(file: LiveCipherFile): Promise<Buffer | null> {
    if (file.encryptedContent && file.encryptedContent.length > 0) {
        return asBuffer(file.encryptedContent);
    }
    const gridFSId = gridFsIdForFile(file);
    if (!gridFSId) return null;
    const { downloadLiveObject } = await import('@/lib/blob-store');
    return downloadLiveObject(gridFSId, file.fileSize ?? undefined);
}

/**
 * Snapshot the current live object as a version.
 * When replacing live GridFS content, pass `moveLiveObject: true` so the existing
 * GridFS id becomes the version blob (no copy). Takeover must copy (`moveLiveObject: false`).
 */
export async function buildVersionSnapshot(
    file: LiveCipherFile,
    options?: { moveLiveObject?: boolean },
): Promise<{
    storageKey: string | null;
    encryptedContent: Buffer | null;
    iv: string;
    authTag: string;
    encryptedDek: string | null;
    fileSize: number;
} | null> {
    if (!file.iv || !file.authTag) return null;

    const pointer = gridFsIdForFile(file);
    if (pointer && options?.moveLiveObject) {
        return {
            storageKey: storageKeyForPointer(pointer),
            encryptedContent: null,
            iv: file.iv,
            authTag: file.authTag,
            encryptedDek: file.encryptedDek ?? null,
            fileSize: file.fileSize ?? 0,
        };
    }

    const ciphertext = await resolveLiveCiphertext(file);
    if (!ciphertext) return null;

    const storageKey = await putCiphertext(ciphertext, {
        fileName: `${file.fileName || file.id}.enc`,
        folder: VERSION_FOLDER,
        uploadedBy: 'version-snapshot',
    });

    return {
        storageKey,
        encryptedContent: storageKey ? null : ciphertext,
        iv: file.iv,
        authTag: file.authTag,
        encryptedDek: file.encryptedDek ?? null,
        fileSize: file.fileSize ?? ciphertext.length,
    };
}

export async function createFileVersionRow(params: {
    fileId: string;
    versionNumber: number;
    snapshot: NonNullable<Awaited<ReturnType<typeof buildVersionSnapshot>>>;
    changeType: string;
    changeDescription?: string | null;
    createdBy?: string | null;
    reason?: string | null;
    previousVersionId?: string | null;
}) {
    return prisma.fileVersion.create({
        data: {
            fileId: params.fileId,
            versionNumber: params.versionNumber,
            encryptedContent: params.snapshot.encryptedContent,
            storageKey: params.snapshot.storageKey,
            iv: params.snapshot.iv,
            authTag: params.snapshot.authTag,
            encryptedDek: params.snapshot.encryptedDek,
            fileSize: params.snapshot.fileSize,
            changeType: params.changeType,
            changeDescription: params.changeDescription ?? undefined,
            createdBy: params.createdBy ?? undefined,
            reason: params.reason ?? undefined,
            previousVersionId: params.previousVersionId ?? undefined,
        },
        select: { id: true, versionNumber: true, previousVersionId: true, storageKey: true },
    });
}

export async function loadVersionCiphertext(version: VersionCipherRow): Promise<Buffer | null> {
    if (version.storageKey) {
        try {
            return await getCiphertext(version.storageKey, version.fileSize ?? undefined);
        } catch {
            // Fall through to legacy BYTEA
        }
    }
    if (version.encryptedContent && version.encryptedContent.length > 0) {
        return asBuffer(version.encryptedContent);
    }
    return null;
}

export async function uploadDraftBlob(params: {
    fileName: string;
    mimeType: string;
    fileExtension: string;
    ciphertext: Buffer;
    uploadedBy?: string;
    folder?: string;
}): Promise<{ gridFSId: string; checksum: string } | null> {
    if (!blobStoreEnabled()) return null;
    const key = await putCiphertext(params.ciphertext, {
        fileName: params.fileName,
        folder: params.folder ?? DRAFT_FOLDER,
        uploadedBy: params.uploadedBy,
    });
    if (!key) return null;
    const checksum = crypto.createHash('sha256').update(params.ciphertext).digest('hex');
    return { gridFSId: mongoPointerFromStorageKey(key), checksum };
}

export async function persistLiveCiphertext(params: {
    fileId: string;
    fileName: string;
    mimeType: string;
    fileExtension: string;
    ciphertext: Buffer;
    iv: string;
    authTag: string;
    encryptedDek: string;
    plaintextSize: number;
    existingMongoFileId?: string | null;
    uploadedBy?: string;
}): Promise<{ mongoFileId: string | null; usedBlobStore: boolean }> {
    const uploaded = await uploadDraftBlob({
        fileName: params.fileName,
        mimeType: params.mimeType,
        fileExtension: params.fileExtension,
        ciphertext: params.ciphertext,
        uploadedBy: params.uploadedBy,
        folder: DRAFT_FOLDER,
    });
    if (!uploaded) {
        await prisma.userFile.update({
            where: { id: params.fileId },
            data: {
                encryptedContent: params.ciphertext,
                iv: params.iv,
                authTag: params.authTag,
                encryptedDek: params.encryptedDek,
                fileSize: params.plaintextSize,
            },
        });
        return { mongoFileId: params.existingMongoFileId ?? null, usedBlobStore: false };
    }

    let mongoFileId = params.existingMongoFileId ?? null;
    if (mongoFileId) {
        await prisma.mongoFile.update({
            where: { id: mongoFileId },
            data: {
                gridFSId: uploaded.gridFSId,
                mimeType: params.mimeType,
                fileSize: params.plaintextSize,
                checksum: uploaded.checksum,
                folder: DRAFT_FOLDER,
            },
        });
    } else {
        const created = await prisma.mongoFile.create({
            data: {
                gridFSId: uploaded.gridFSId,
                originalFileName: params.fileName,
                mimeType: params.mimeType,
                fileExtension: params.fileExtension.replace(/^\./, '') || 'bin',
                fileSize: params.plaintextSize,
                checksum: uploaded.checksum,
                folder: DRAFT_FOLDER,
                uploadedBy: params.uploadedBy || 'system',
                classification: 'RESTRICTED',
                scanStatus: 'pending',
            },
            select: { id: true },
        });
        mongoFileId = created.id;
    }

    await prisma.userFile.update({
        where: { id: params.fileId },
        data: {
            encryptedContent: null,
            iv: params.iv,
            authTag: params.authTag,
            encryptedDek: params.encryptedDek,
            fileSize: params.plaintextSize,
            mongoFileId,
        },
    });

    return { mongoFileId, usedBlobStore: true };
}

export async function trimOldFileVersions(fileId: string, keep = MAX_VERSIONS): Promise<void> {
    const versionCount = await prisma.fileVersion.count({ where: { fileId } });
    if (versionCount <= keep) return;

    const versionsToDelete = await prisma.fileVersion.findMany({
        where: { fileId },
        orderBy: { versionNumber: 'asc' },
        take: versionCount - keep,
        select: { id: true, storageKey: true },
    });
    await prisma.fileVersion.deleteMany({
        where: { id: { in: versionsToDelete.map((v) => v.id) } },
    });
    await deleteCiphertexts(versionsToDelete.map((v) => v.storageKey));
}

export async function collectVersionStorageKeys(fileIds: string[]): Promise<string[]> {
    if (fileIds.length === 0) return [];
    const rows = await prisma.fileVersion.findMany({
        where: { fileId: { in: fileIds } },
        select: { storageKey: true },
    });
    return rows.map((r) => r.storageKey).filter((k): k is string => Boolean(k));
}
