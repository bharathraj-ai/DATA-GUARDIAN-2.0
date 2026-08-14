import { decryptBuffer, decryptDek } from '@/lib/crypto';
import { downloadFromMongo } from '@/lib/mongo/operations';
import { gridFsIdForFile, type UserFileContentRow } from '@/lib/security/resource-ownership';

type DecryptableFile = {
    encryptedContent?: Buffer | Uint8Array | null;
    iv?: string | null;
    authTag?: string | null;
    encryptedDek?: string | null;
    fileSize?: number | null;
} & UserFileContentRow;

function asBuffer(data: Buffer | Uint8Array): Buffer {
    return Buffer.isBuffer(data) ? data : Buffer.from(data);
}

/** Decrypt a UserFile row (inline BYTEA draft or GridFS ciphertext). */
export async function decryptUserFileBytes(fileRecord: DecryptableFile): Promise<Buffer> {
    if (fileRecord.encryptedContent && fileRecord.iv && fileRecord.authTag) {
        const dek = fileRecord.encryptedDek ? decryptDek(fileRecord.encryptedDek) : undefined;
        return decryptBuffer(
            asBuffer(fileRecord.encryptedContent),
            fileRecord.iv,
            fileRecord.authTag,
            dek,
        );
    }

    const gridFSId = gridFsIdForFile(fileRecord);
    if (!gridFSId) {
        throw new Error('File has no content available');
    }

    const downloaded = await downloadFromMongo(gridFSId, fileRecord.fileSize ?? undefined);
    if (fileRecord.iv && fileRecord.authTag) {
        const dek = fileRecord.encryptedDek ? decryptDek(fileRecord.encryptedDek) : undefined;
        return decryptBuffer(downloaded, fileRecord.iv, fileRecord.authTag, dek);
    }
    return downloaded;
}
