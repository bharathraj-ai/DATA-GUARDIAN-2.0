import { logger } from '@/lib/logger';

export interface StorageMetadata {
  originalFilename?: string;
  mimeType?: string;
  fileSize?: number;
  encryptionAlgorithm?: string;
  encryptionIV?: string;
  authenticationTag?: string;
  encryptedDEK?: string;
  uploadedBy?: string;
  classification?: string;
  documentId?: string;
  version?: number;
  [key: string]: unknown;
}

export interface StorageUploadOptions {
  metadata?: StorageMetadata;
  contentType?: string;
  chunkSizeBytes?: number;
}

export interface StorageFileInfo {
  fileId: string;
  filename: string;
  length: number;
  chunkSize?: number;
  uploadDate: Date;
  metadata?: StorageMetadata;
}

export interface IStorageProvider {
  readonly providerName: 'mongodb' | 'local';

  upload(
    buffer: Buffer,
    filename: string,
    options?: StorageUploadOptions
  ): Promise<{ storageFileId: string; size: number }>;

  download(storageFileId: string): Promise<Buffer>;

  downloadStream(storageFileId: string): Promise<NodeJS.ReadableStream>;

  delete(storageFileId: string): Promise<void>;

  exists(storageFileId: string): Promise<boolean>;

  getMetadata(storageFileId: string): Promise<StorageMetadata | null>;

  getFileInfo(storageFileId: string): Promise<StorageFileInfo | null>;
}

let _providerInstance: IStorageProvider | null = null;

export function getStorageProvider(): IStorageProvider {
  if (_providerInstance) return _providerInstance;

  const configured = (process.env.STORAGE_PROVIDER || '').trim().toLowerCase();
  const isProduction = process.env.NODE_ENV === 'production';

  // Production Safety Rule: In production, never silently fall back to local filesystem!
  if (isProduction && configured === 'local') {
    throw new Error(
      '[Storage] STORAGE_PROVIDER=local is forbidden in production environment. ' +
      'Data Guardian 2.0 requires persistent MongoDB GridFS storage in production.'
    );
  }

  const providerType = configured || (isProduction ? 'mongodb' : 'mongodb');

  if (providerType === 'local') {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { LocalStorageProvider } = require('./local.provider');
    _providerInstance = new LocalStorageProvider();
    logger.info('[Storage] Initialized LocalStorageProvider (Development Mode)');
    return _providerInstance!;
  }

  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { MongoDBStorageProvider } = require('./mongodb.provider');
  _providerInstance = new MongoDBStorageProvider();
  logger.info('[Storage] Initialized MongoDBStorageProvider (GridFS)');
  return _providerInstance!;
}

/** Reset cached provider instance (useful for unit testing different providers). */
export function resetStorageProvider(): void {
  _providerInstance = null;
}

