import { getGridFSBucket, getMongoDb, GRIDFS_CHUNK_SIZE, withMongoRetry } from './client';
import { ObjectId } from 'mongodb';
import { Readable, Transform } from 'stream';
import crypto from 'crypto';

export interface MongoUploadParams {
  buffer: Buffer;
  originalFileName: string;
  mimeType: string;
  fileExtension: string;
  folder: string;
  projectId?: string;
  vendorId?: string;
  uploadedBy: string;
  classification?: string;
  extraMetadata?: Record<string, string>;
}

export interface MongoStreamUploadParams {
  stream: Readable | Transform;
  originalFileName: string;
  mimeType: string;
  fileExtension: string;
  folder: string;
  projectId?: string;
  vendorId?: string;
  uploadedBy: string;
  classification?: string;
}

export interface MongoUploadResult {
  gridFSId: string;
  checksum: string;
  fileSize: number;
  mimeType: string;
}

export function computeChecksum(buffer: Buffer): string {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

function uploadMetadata(params: {
  mimeType: string;
  fileExtension: string;
  folder: string;
  projectId?: string;
  vendorId?: string;
  uploadedBy: string;
  classification?: string;
  checksum?: string;
  extraMetadata?: Record<string, string>;
}) {
  return {
    mimeType: params.mimeType,
    fileExtension: params.fileExtension,
    folder: params.folder,
    projectId: params.projectId,
    vendorId: params.vendorId,
    uploadedBy: params.uploadedBy,
    classification: params.classification || 'INTERNAL',
    ...(params.checksum ? { checksum: params.checksum } : {}),
    ...(params.extraMetadata || {}),
  };
}

/**
 * Direct chunk inserts — GridFS streams add seconds of backpressure on small files.
 * Same `uploads.files` / `uploads.chunks` layout as `openUploadStream`, so downloads stay compatible.
 */
export async function uploadToMongo(params: MongoUploadParams): Promise<MongoUploadResult> {
  const checksum = computeChecksum(params.buffer);
  const length = params.buffer.length;
  const chunkSize = GRIDFS_CHUNK_SIZE;

  return withMongoRetry(async () => {
    const db = await getMongoDb();
    const id = new ObjectId();

    if (length > 0) {
      const chunkDocs = [];
      for (let offset = 0, n = 0; offset < length; offset += chunkSize, n++) {
        const slice = params.buffer.subarray(offset, Math.min(offset + chunkSize, length));
        chunkDocs.push({
          files_id: id,
          n,
          data: offset === 0 && slice.length === length ? params.buffer : Buffer.from(slice),
        });
      }
      const chunks = db.collection('uploads.chunks');
      if (chunkDocs.length === 1) {
        await chunks.insertOne(chunkDocs[0]);
      } else {
        await chunks.insertMany(chunkDocs, { ordered: true });
      }
    }

    await db.collection('uploads.files').insertOne({
      _id: id,
      length,
      chunkSize,
      uploadDate: new Date(),
      filename: params.originalFileName,
      metadata: uploadMetadata({ ...params, checksum }),
    });

    return {
      gridFSId: id.toString(),
      checksum,
      fileSize: length,
      mimeType: params.mimeType,
    };
  });
}

export async function uploadStreamToMongo(params: MongoStreamUploadParams): Promise<MongoUploadResult> {
  const bucket = await getGridFSBucket();
  const hash = crypto.createHash('sha256');
  let fileSize = 0;

  const hasher = new Transform({
    transform(chunk, _enc, cb) {
      hash.update(chunk);
      fileSize += chunk.length;
      cb(null, chunk);
    },
  });

  return new Promise((resolve, reject) => {
    const uploadStream = bucket.openUploadStream(params.originalFileName, {
      chunkSizeBytes: GRIDFS_CHUNK_SIZE,
      metadata: uploadMetadata(params),
    });

    params.stream
      .pipe(hasher)
      .pipe(uploadStream)
      .on('error', reject)
      .on('finish', () => {
        resolve({
          gridFSId: uploadStream.id.toString(),
          checksum: hash.digest('hex'),
          fileSize,
          mimeType: params.mimeType,
        });
      });
  });
}

export async function downloadFromMongo(gridFSId: string, expectedSize?: number): Promise<Buffer> {
  const bucket = await getGridFSBucket();
  const downloadStream = bucket.openDownloadStream(new ObjectId(gridFSId));
  const known = typeof expectedSize === 'number' && expectedSize > 0 && expectedSize <= 80 * 1024 * 1024;

  if (known) {
    const out = Buffer.allocUnsafe(expectedSize!);
    let offset = 0;
    const overflow: Buffer[] = [];
    return new Promise((resolve, reject) => {
      downloadStream.on('data', (chunk: Buffer) => {
        const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        if (overflow.length === 0 && offset + bytes.length <= out.length) {
          bytes.copy(out, offset);
          offset += bytes.length;
          return;
        }
        if (overflow.length === 0) {
          overflow.push(out.subarray(0, offset), bytes);
        } else {
          overflow.push(bytes);
        }
        offset += bytes.length;
      });
      downloadStream.on('error', reject);
      downloadStream.on('end', () => {
        if (overflow.length === 0) {
          resolve(offset === out.length ? out : out.subarray(0, offset));
          return;
        }
        resolve(Buffer.concat(overflow, offset));
      });
    });
  }

  const chunks: Buffer[] = [];
  let total = 0;
  return new Promise((resolve, reject) => {
    downloadStream.on('data', (chunk: Buffer) => {
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      chunks.push(bytes);
      total += bytes.length;
    });
    downloadStream.on('error', reject);
    downloadStream.on('end', () => resolve(Buffer.concat(chunks, total)));
  });
}

/**
 * Delete a file from GridFS by its gridFSId.
 * Silently succeeds if the file doesn't exist (idempotent).
 */
export async function deleteFromMongo(gridFSId: string): Promise<void> {
  try {
    const bucket = await getGridFSBucket();
    await bucket.delete(new ObjectId(gridFSId));
  } catch (err: any) {
    if (err?.message?.includes('FileNotFound') || err?.code === 'FileNotFound' || /file not found/i.test(err?.message)) {
      return;
    }
    console.error(`[Mongo] Failed to delete GridFS file ${gridFSId}:`, err);
    throw err;
  }
}
