import { getGridFSBucket } from './client';
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

export async function uploadToMongo(params: MongoUploadParams): Promise<MongoUploadResult> {
  const bucket = await getGridFSBucket();
  const checksum = computeChecksum(params.buffer);

  const readableStream = Readable.from(params.buffer);
  
  return new Promise((resolve, reject) => {
    const uploadStream = bucket.openUploadStream(params.originalFileName, {
      metadata: {
        mimeType: params.mimeType,
        fileExtension: params.fileExtension,
        folder: params.folder,
        projectId: params.projectId,
        vendorId: params.vendorId,
        uploadedBy: params.uploadedBy,
        classification: params.classification || 'INTERNAL',
        checksum,
      }
    });

    readableStream.pipe(uploadStream)
      .on('error', reject)
      .on('finish', () => {
        resolve({
          gridFSId: uploadStream.id.toString(),
          checksum,
          fileSize: params.buffer.length,
          mimeType: params.mimeType
        });
      });
  });
}

export async function uploadStreamToMongo(params: MongoStreamUploadParams): Promise<MongoUploadResult> {
  const bucket = await getGridFSBucket();
  
  return new Promise((resolve, reject) => {
    // We cannot compute checksum on the fly without consuming the stream, 
    // so we skip the custom checksum or use a passthrough stream to compute it.
    const hash = crypto.createHash('sha256');
    let checksum = '';
    let fileSize = 0;

    const uploadStream = bucket.openUploadStream(params.originalFileName, {
      metadata: {
        mimeType: params.mimeType,
        fileExtension: params.fileExtension,
        folder: params.folder,
        projectId: params.projectId,
        vendorId: params.vendorId,
        uploadedBy: params.uploadedBy,
        classification: params.classification || 'INTERNAL',
      }
    });

    params.stream
      .on('data', (chunk) => {
        hash.update(chunk);
        fileSize += chunk.length;
      })
      .pipe(uploadStream)
      .on('error', reject)
      .on('finish', async () => {
        checksum = hash.digest('hex');
        
        try {
          // Update the metadata with the checksum after upload
          const { getMongoClient } = await import('./client');
          const client = await getMongoClient();
          const db = client.db(process.env.MONGODB_DB_NAME || 'data-guardian');
          await db.collection('fs.files').updateOne(
            { _id: uploadStream.id },
            { $set: { 'metadata.checksum': checksum } }
          );

          resolve({
            gridFSId: uploadStream.id.toString(),
            checksum,
            fileSize,
            mimeType: params.mimeType
          });
        } catch (e) {
          reject(e);
        }
      });
  });
}

export async function downloadFromMongo(gridFSId: string): Promise<Buffer> {
  const bucket = await getGridFSBucket();
  
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    const downloadStream = bucket.openDownloadStream(new ObjectId(gridFSId));
    
    downloadStream.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
    downloadStream.on('error', reject);
    downloadStream.on('end', () => resolve(Buffer.concat(chunks)));
  });
}
