import { ObjectId } from 'mongodb';
import { Readable } from 'stream';
import {
  IStorageProvider,
  StorageMetadata,
  StorageUploadOptions,
  StorageFileInfo,
} from './storage-provider';
import { getGridFSBucket, GRIDFS_CHUNK_SIZE } from './mongodb-client';
import { logger } from '@/lib/logger';

export class MongoDBStorageProvider implements IStorageProvider {
  public readonly providerName = 'mongodb' as const;

  public async upload(
    buffer: Buffer,
    filename: string,
    options?: StorageUploadOptions
  ): Promise<{ storageFileId: string; size: number }> {
    const bucket = await getGridFSBucket();
    const chunkSizeBytes = options?.chunkSizeBytes || GRIDFS_CHUNK_SIZE;
    const metadata = {
      ...(options?.metadata || {}),
      contentType: options?.contentType || 'application/octet-stream',
    };

    return new Promise((resolve, reject) => {
      const uploadStream = bucket.openUploadStream(filename, {
        chunkSizeBytes,
        metadata,
      });

      const readable = new Readable();
      readable.push(buffer);
      readable.push(null);

      readable
        .pipe(uploadStream)
        .on('error', (err) => {
          logger.error(`[MongoDBProvider] Upload failed for ${filename}:`, err);
          reject(err);
        })
        .on('finish', () => {
          resolve({
            storageFileId: uploadStream.id.toString(),
            size: buffer.length,
          });
        });
    });
  }

  public async download(storageFileId: string): Promise<Buffer> {
    const stream = await this.downloadStream(storageFileId);
    const chunks: Buffer[] = [];
    let totalLength = 0;

    return new Promise((resolve, reject) => {
      stream.on('data', (chunk: Buffer) => {
        const b = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        chunks.push(b);
        totalLength += b.length;
      });
      stream.on('error', (err) => {
        logger.error(`[MongoDBProvider] Download failed for ${storageFileId}:`, err);
        reject(err);
      });
      stream.on('end', () => {
        resolve(Buffer.concat(chunks, totalLength));
      });
    });
  }

  public async downloadStream(storageFileId: string): Promise<NodeJS.ReadableStream> {
    const bucket = await getGridFSBucket();
    let oid: ObjectId;
    try {
      oid = new ObjectId(storageFileId);
    } catch {
      throw new Error(`Invalid GridFS file identifier: ${storageFileId}`);
    }

    // Verify file existence first to provide clean 404/not-found errors
    const files = await bucket.find({ _id: oid }).limit(1).toArray();
    if (files.length === 0) {
      throw new Error(`File not found in MongoDB GridFS: ${storageFileId}`);
    }

    return bucket.openDownloadStream(oid);
  }

  public async delete(storageFileId: string): Promise<void> {
    let oid: ObjectId;
    try {
      oid = new ObjectId(storageFileId);
    } catch {
      return; // Invalid ID is treated as already non-existent
    }

    try {
      const bucket = await getGridFSBucket();
      await bucket.delete(oid);
    } catch (err: any) {
      if (
        err?.message?.includes('FileNotFound') ||
        err?.code === 'FileNotFound' ||
        /file not found/i.test(err?.message)
      ) {
        return; // Idempotent: already deleted
      }
      logger.error(`[MongoDBProvider] Delete failed for ${storageFileId}:`, err);
      throw err;
    }
  }

  public async exists(storageFileId: string): Promise<boolean> {
    try {
      const oid = new ObjectId(storageFileId);
      const bucket = await getGridFSBucket();
      const files = await bucket.find({ _id: oid }).limit(1).toArray();
      return files.length > 0;
    } catch {
      return false;
    }
  }

  public async getMetadata(storageFileId: string): Promise<StorageMetadata | null> {
    const info = await this.getFileInfo(storageFileId);
    return info?.metadata || null;
  }

  public async getFileInfo(storageFileId: string): Promise<StorageFileInfo | null> {
    try {
      const oid = new ObjectId(storageFileId);
      const bucket = await getGridFSBucket();
      const files = await bucket.find({ _id: oid }).limit(1).toArray();
      if (files.length === 0) return null;

      const fileDoc = files[0];
      return {
        fileId: fileDoc._id.toString(),
        filename: fileDoc.filename,
        length: fileDoc.length,
        chunkSize: fileDoc.chunkSize,
        uploadDate: fileDoc.uploadDate,
        metadata: (fileDoc.metadata as StorageMetadata) || undefined,
      };
    } catch {
      return null;
    }
  }
}
