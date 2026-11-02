import fs from 'fs/promises';
import { createReadStream } from 'fs';
import path from 'path';
import crypto from 'crypto';
import {
  IStorageProvider,
  StorageMetadata,
  StorageUploadOptions,
  StorageFileInfo,
} from './storage-provider';
import { getStorageRoot, assertSafeSegment } from './secureStorage';
import { logger } from '@/lib/logger';

export class LocalStorageProvider implements IStorageProvider {
  public readonly providerName = 'local' as const;

  private getRoot(): string {
    return getStorageRoot();
  }

  private getFilePath(storageFileId: string): string {
    const safeId = assertSafeSegment(storageFileId, 'storageFileId');
    return path.resolve(this.getRoot(), 'local-store', safeId);
  }

  private getMetaPath(storageFileId: string): string {
    return `${this.getFilePath(storageFileId)}.meta.json`;
  }

  private async ensureDir(): Promise<void> {
    const dir = path.resolve(this.getRoot(), 'local-store');
    await fs.mkdir(dir, { recursive: true });
  }

  public async upload(
    buffer: Buffer,
    filename: string,
    options?: StorageUploadOptions
  ): Promise<{ storageFileId: string; size: number }> {
    await this.ensureDir();
    const fileId = crypto.randomUUID();
    const filePath = this.getFilePath(fileId);
    const metaPath = this.getMetaPath(fileId);

    const meta: StorageFileInfo = {
      fileId,
      filename,
      length: buffer.length,
      uploadDate: new Date(),
      metadata: options?.metadata,
    };

    await fs.writeFile(filePath, buffer);
    await fs.writeFile(metaPath, JSON.stringify(meta, null, 2), 'utf-8');

    return { storageFileId: fileId, size: buffer.length };
  }

  public async download(storageFileId: string): Promise<Buffer> {
    const filePath = this.getFilePath(storageFileId);
    try {
      return await fs.readFile(filePath);
    } catch (err: any) {
      if (err.code === 'ENOENT') {
        throw new Error(`File not found in local storage: ${storageFileId}`);
      }
      throw err;
    }
  }

  public async downloadStream(storageFileId: string): Promise<NodeJS.ReadableStream> {
    const filePath = this.getFilePath(storageFileId);
    try {
      await fs.access(filePath);
    } catch {
      throw new Error(`File not found in local storage: ${storageFileId}`);
    }
    return createReadStream(filePath);
  }

  public async delete(storageFileId: string): Promise<void> {
    const filePath = this.getFilePath(storageFileId);
    const metaPath = this.getMetaPath(storageFileId);

    try {
      await fs.unlink(filePath);
    } catch (err: any) {
      if (err.code !== 'ENOENT') {
        logger.error(`[LocalStorageProvider] Failed to delete file: ${storageFileId}`, err);
      }
    }

    try {
      await fs.unlink(metaPath);
    } catch {
      // ignore
    }
  }

  public async exists(storageFileId: string): Promise<boolean> {
    try {
      const filePath = this.getFilePath(storageFileId);
      await fs.access(filePath);
      return true;
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
      const metaPath = this.getMetaPath(storageFileId);
      const raw = await fs.readFile(metaPath, 'utf-8');
      const parsed = JSON.parse(raw);
      return {
        ...parsed,
        uploadDate: new Date(parsed.uploadDate),
      };
    } catch {
      // Fallback: check if raw file exists
      try {
        const filePath = this.getFilePath(storageFileId);
        const stat = await fs.stat(filePath);
        return {
          fileId: storageFileId,
          filename: path.basename(filePath),
          length: stat.size,
          uploadDate: stat.mtime,
        };
      } catch {
        return null;
      }
    }
  }
}

