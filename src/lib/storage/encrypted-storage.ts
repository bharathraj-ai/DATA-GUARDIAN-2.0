import { getStorageProvider, IStorageProvider, StorageMetadata } from './storage-provider';
import {
  generateDek,
  encryptDek,
  decryptDek,
  encryptBuffer,
  decryptBuffer,
} from '@/lib/crypto';
import { logger } from '@/lib/logger';

export interface EncryptedUploadParams {
  buffer: Buffer;
  filename: string;
  mimeType: string;
  uploadedBy: string;
  classification?: string;
  documentId?: string;
  version?: number;
}

export interface EncryptedUploadResult {
  storageFileId: string;
  storageProvider: 'mongodb' | 'local';
  fileSize: number;
  encryptionAlgorithm: string;
  encryptionIV: string;
  authenticationTag: string;
  encryptedDEK: string;
  originalFilename: string;
}

export interface EncryptedDownloadParams {
  storageFileId: string;
  storageProvider?: string;
  encryptedDEK?: string | null;
  encryptionIV?: string | null;
  authenticationTag?: string | null;
}

/**
 * Uploads a file by encrypting it with a unique per-file DEK (AES-256-GCM)
 * and wrapping the DEK with the Master KEK before storing the ciphertext in GridFS.
 *
 * Never stores plaintext files in MongoDB.
 */
export async function uploadEncryptedFile(
  params: EncryptedUploadParams,
  provider?: IStorageProvider
): Promise<EncryptedUploadResult> {
  const activeProvider = provider || getStorageProvider();

  // 1. Generate unique 256-bit DEK
  const dek = generateDek();

  // 2. Encrypt file with AES-256-GCM
  const { iv, authTag, encryptedContent } = encryptBuffer(params.buffer, dek);

  // 3. Wrap DEK with master KEK
  const encryptedDEK = encryptDek(dek);

  const metadata: StorageMetadata = {
    originalFilename: params.filename,
    mimeType: params.mimeType,
    fileSize: params.buffer.length,
    encryptionAlgorithm: 'aes-256-gcm',
    encryptionIV: iv,
    authenticationTag: authTag,
    encryptedDEK,
    uploadedBy: params.uploadedBy,
    classification: params.classification || 'INTERNAL',
    documentId: params.documentId,
    version: params.version ?? 1,
  };

  // 4. Upload ciphertext only to storage provider (GridFS)
  const uploadResult = await activeProvider.upload(encryptedContent, params.filename, {
    metadata,
    contentType: 'application/octet-stream',
  });

  return {
    storageFileId: uploadResult.storageFileId,
    storageProvider: activeProvider.providerName,
    fileSize: params.buffer.length,
    encryptionAlgorithm: 'aes-256-gcm',
    encryptionIV: iv,
    authenticationTag: authTag,
    encryptedDEK,
    originalFilename: params.filename,
  };
}

/**
 * Downloads ciphertext from storage provider and decrypts it using the unwrapped DEK.
 * Authenticates ciphertext with AES-256-GCM auth tag (throws on tampering).
 */
export async function downloadDecryptedFile(
  params: EncryptedDownloadParams,
  provider?: IStorageProvider
): Promise<Buffer> {
  const activeProvider = provider || getStorageProvider();

  // 1. Download ciphertext
  const ciphertext = await activeProvider.download(params.storageFileId);

  // If encryption metadata is present, decrypt and verify
  if (params.encryptedDEK && params.encryptionIV && params.authenticationTag) {
    // 2. Unwrap DEK using KEK (with key rotation support)
    const dek = decryptDek(params.encryptedDEK);

    // 3. Decrypt and verify auth tag
    return decryptBuffer(
      ciphertext,
      params.encryptionIV,
      params.authenticationTag,
      dek
    );
  }

  // Fallback for unencrypted legacy or raw blobs if metadata is missing
  return ciphertext;
}

/**
 * Idempotently deletes an encrypted file from the storage provider.
 */
export async function deleteEncryptedFile(
  storageFileId: string,
  provider?: IStorageProvider
): Promise<void> {
  const activeProvider = provider || getStorageProvider();
  await activeProvider.delete(storageFileId);
}

