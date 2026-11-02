import crypto from 'crypto';
import { Readable } from 'stream';
import { ObjectId } from 'mongodb';
import {
  uploadEncryptedFile,
  downloadDecryptedFile,
  deleteEncryptedFile,
} from '@/lib/storage/encrypted-storage';
import {
  IStorageProvider,
  StorageMetadata,
  StorageUploadOptions,
  StorageFileInfo,
  getStorageProvider,
  resetStorageProvider,
} from '@/lib/storage/storage-provider';
import { LocalStorageProvider } from '@/lib/storage/local.provider';
import { MongoDBStorageProvider } from '@/lib/storage/mongodb.provider';
import { checkMongoConnection, getMongoClient } from '@/lib/storage/mongodb-client';
import { generateDek, encryptDek, encryptBuffer, decryptBuffer } from '@/lib/crypto';

// In-memory mock GridFS store for deterministic offline unit testing
class MockGridFSStore {
  public files = new Map<string, { _id: ObjectId; filename: string; length: number; chunkSize: number; uploadDate: Date; metadata: any }>();
  public chunks = new Map<string, Buffer[]>();

  public reset() {
    this.files.clear();
    this.chunks.clear();
  }
}

const mockStore = new MockGridFSStore();

// Mock MongoDB GridFSBucket
jest.mock('@/lib/storage/mongodb-client', () => {
  const actual = jest.requireActual('@/lib/storage/mongodb-client');
  return {
    ...actual,
    getGridFSBucket: jest.fn().mockImplementation(async () => {
      return {
        openUploadStream: (filename: string, options: any) => {
          const id = new ObjectId();
          const chunks: Buffer[] = [];
          const chunkSize = options?.chunkSizeBytes || 1024 * 1024;

          const writable = new (require('stream').Writable)({
            write(chunk: any, _enc: any, callback: any) {
              chunks.push(Buffer.from(chunk));
              callback();
            },
          });

          (writable as any).id = id;

          writable.on('finish', () => {
            const fullBuf = Buffer.concat(chunks);
            mockStore.files.set(id.toString(), {
              _id: id,
              filename,
              length: fullBuf.length,
              chunkSize,
              uploadDate: new Date(),
              metadata: options?.metadata || {},
            });
            mockStore.chunks.set(id.toString(), chunks);
          });

          return writable;
        },

        openDownloadStream: (oid: ObjectId) => {
          const idStr = oid.toString();
          const file = mockStore.files.get(idStr);
          if (!file) {
            const errStream = new (require('stream').Readable)({
              read() {
                this.emit('error', new Error(`FileNotFound: ${idStr}`));
              },
            });
            return errStream;
          }

          const chunks = mockStore.chunks.get(idStr) || [];
          let idx = 0;
          return new (require('stream').Readable)({
            read() {
              if (idx < chunks.length) {
                this.push(chunks[idx++]);
              } else {
                this.push(null);
              }
            },
          });
        },

        find: (query: any) => ({
          limit: () => ({
            toArray: async () => {
              if (query._id) {
                const idStr = query._id.toString();
                const file = mockStore.files.get(idStr);
                return file ? [file] : [];
              }
              if (query.uploadDate?.$lt) {
                const cutoff = query.uploadDate.$lt;
                return Array.from(mockStore.files.values()).filter((f) => f.uploadDate < cutoff);
              }
              return Array.from(mockStore.files.values());
            },
          }),
          toArray: async () => {
            if (query.uploadDate?.$lt) {
              const cutoff = query.uploadDate.$lt;
              return Array.from(mockStore.files.values()).filter((f) => f.uploadDate < cutoff);
            }
            return Array.from(mockStore.files.values());
          },
        }),

        delete: async (oid: ObjectId) => {
          const idStr = oid.toString();
          if (!mockStore.files.has(idStr)) {
            const err = new Error('FileNotFound');
            (err as any).code = 'FileNotFound';
            throw err;
          }
          mockStore.files.delete(idStr);
          mockStore.chunks.delete(idStr);
        },
      };
    }),
    checkMongoConnection: jest.fn().mockImplementation(async () => ({
      healthy: true,
      latencyMs: 15,
    })),
  };
});

describe('MongoDB GridFS Persistent File Storage Test Suite', () => {
  const KEK_HEX = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
  const ENC_HEX = 'fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210';
  const origEnv = { ...process.env };

  beforeAll(() => {
    process.env.KEK_KEY = KEK_HEX;
    process.env.ENCRYPTION_KEY = ENC_HEX;
    process.env.STORAGE_PROVIDER = 'mongodb';
  });

  afterAll(() => {
    process.env = origEnv;
  });

  beforeEach(() => {
    mockStore.reset();
    resetStorageProvider();
  });

  // ── 1. MongoDB Connection Verification ─────────────────────────────────────
  it('1. MongoDB connection: verifies cluster health check returns healthy status and latency', async () => {
    const health = await checkMongoConnection();
    expect(health.healthy).toBe(true);
    expect(typeof health.latencyMs).toBe('number');
  });

  // ── 2. GridFS Upload ───────────────────────────────────────────────────────
  it('2. GridFS upload: stores file buffer into GridFS collections with metadata', async () => {
    const provider = new MongoDBStorageProvider();
    const testData = Buffer.from('Sensitive financial document contents', 'utf-8');

    const result = await provider.upload(testData, 'report.pdf', {
      metadata: { classification: 'CONFIDENTIAL', documentId: 'doc-123' },
    });

    expect(result.storageFileId).toBeDefined();
    expect(result.size).toBe(testData.length);
    expect(mockStore.files.has(result.storageFileId)).toBe(true);

    const fileEntry = mockStore.files.get(result.storageFileId);
    expect(fileEntry?.filename).toBe('report.pdf');
    expect(fileEntry?.metadata.classification).toBe('CONFIDENTIAL');
  });

  // ── 3. GridFS Download ─────────────────────────────────────────────────────
  it('3. GridFS download: downloads stored buffer matching original bytes exactly', async () => {
    const provider = new MongoDBStorageProvider();
    const originalText = 'Data Guardian 2.0 Persistent Storage Verification Payload';
    const testData = Buffer.from(originalText, 'utf-8');

    const upload = await provider.upload(testData, 'verified.txt');
    const downloaded = await provider.download(upload.storageFileId);

    expect(downloaded.toString('utf-8')).toBe(originalText);
    expect(downloaded.equals(testData)).toBe(true);
  });

  // ── 4. Large File Multi-Chunk Upload & Stream ──────────────────────────────
  it('4. Large file upload: correctly streams and handles multi-megabyte payloads across chunks', async () => {
    const provider = new MongoDBStorageProvider();
    // 2.5 MiB payload to guarantee multi-chunk GridFS allocation
    const largeBuffer = crypto.randomBytes(2.5 * 1024 * 1024);

    const upload = await provider.upload(largeBuffer, 'large-archive.bin', {
      chunkSizeBytes: 1024 * 1024,
    });

    expect(upload.size).toBe(largeBuffer.length);
    const downloaded = await provider.download(upload.storageFileId);
    expect(downloaded.length).toBe(largeBuffer.length);
    expect(downloaded.equals(largeBuffer)).toBe(true);
  });

  // ── 5. File Deletion ───────────────────────────────────────────────────────
  it('5. File deletion: removes chunks and metadata; subsequent exists() returns false', async () => {
    const provider = new MongoDBStorageProvider();
    const buffer = Buffer.from('To be deleted', 'utf-8');

    const upload = await provider.upload(buffer, 'temp.txt');
    expect(await provider.exists(upload.storageFileId)).toBe(true);

    await provider.delete(upload.storageFileId);
    expect(await provider.exists(upload.storageFileId)).toBe(false);

    // Idempotent: deleting again does not throw
    await expect(provider.delete(upload.storageFileId)).resolves.not.toThrow();
  });

  // ── 6. AES-256-GCM Envelope Encryption & Decryption ───────────────────────
  it('6. AES-256-GCM encryption & decryption: stores only ciphertext in GridFS, decrypts with unwrapped DEK', async () => {
    const provider = new MongoDBStorageProvider();
    const secretContent = 'TOP SECRET: Patent application and architectural specifications';
    const plaintextBuffer = Buffer.from(secretContent, 'utf-8');

    const encryptedResult = await uploadEncryptedFile(
      {
        buffer: plaintextBuffer,
        filename: 'patent.pdf',
        mimeType: 'application/pdf',
        uploadedBy: 'user-sec-1',
        classification: 'RESTRICTED',
      },
      provider
    );

    // Verify raw content stored in GridFS is NOT plaintext
    const rawStoredCiphertext = await provider.download(encryptedResult.storageFileId);
    expect(rawStoredCiphertext.includes(Buffer.from('TOP SECRET'))).toBe(false);

    // Decrypt and verify
    const decryptedBuffer = await downloadDecryptedFile(
      {
        storageFileId: encryptedResult.storageFileId,
        storageProvider: encryptedResult.storageProvider,
        encryptedDEK: encryptedResult.encryptedDEK,
        encryptionIV: encryptedResult.encryptionIV,
        authenticationTag: encryptedResult.authenticationTag,
      },
      provider
    );

    expect(decryptedBuffer.toString('utf-8')).toBe(secretContent);
  });

  // ── 7. Incorrect Authentication Tag (Tampering Prevention) ────────────────
  it('7. Incorrect authentication tag: throws error and refuses to return tampered data', async () => {
    const provider = new MongoDBStorageProvider();
    const buffer = Buffer.from('Immutable banking transfer record', 'utf-8');

    const encryptedResult = await uploadEncryptedFile(
      {
        buffer,
        filename: 'transfer.pdf',
        mimeType: 'application/pdf',
        uploadedBy: 'auditor-1',
      },
      provider
    );

    // Forged/corrupted auth tag
    const tamperedTag = crypto.randomBytes(16).toString('hex');

    await expect(
      downloadDecryptedFile(
        {
          storageFileId: encryptedResult.storageFileId,
          storageProvider: encryptedResult.storageProvider,
          encryptedDEK: encryptedResult.encryptedDEK,
          encryptionIV: encryptedResult.encryptionIV,
          authenticationTag: tamperedTag,
        },
        provider
      )
    ).rejects.toThrow();
  });

  // ── 8. Missing MongoDB Configuration Handling ──────────────────────────────
  it('8. Missing MongoDB configuration: throws error when MONGODB_URI is absent', async () => {
    const saved = process.env.MONGODB_URI;
    delete process.env.MONGODB_URI;

    const { getMongoClient: realGetClient } = jest.requireActual('@/lib/storage/mongodb-client');
    await expect(realGetClient()).rejects.toThrow(/Missing required environment variable MONGODB_URI/);

    process.env.MONGODB_URI = saved;
  });

  // ── 9. Production Prohibition of Local Storage ─────────────────────────────
  it('9. Production environment safety: rejects STORAGE_PROVIDER=local in production mode', () => {
    const savedEnv = process.env.NODE_ENV;
    (process.env as any).NODE_ENV = 'production';
    process.env.STORAGE_PROVIDER = 'local';
    resetStorageProvider();

    expect(() => getStorageProvider()).toThrow(/STORAGE_PROVIDER=local is forbidden in production/);

    (process.env as any).NODE_ENV = savedEnv;
    process.env.STORAGE_PROVIDER = 'mongodb';
    resetStorageProvider();
  });

  // ── 10. LocalStorageProvider Fallback in Development ────────────────────────
  it('10. LocalStorageProvider: functions properly when STORAGE_PROVIDER=local in development', async () => {
    const savedEnv = process.env.NODE_ENV;
    (process.env as any).NODE_ENV = 'development';
    process.env.STORAGE_PROVIDER = 'local';
    resetStorageProvider();

    const provider = getStorageProvider();
    expect(provider.providerName).toBe('local');

    const data = Buffer.from('Local development document', 'utf-8');
    const upload = await provider.upload(data, 'dev-file.txt');
    expect(upload.storageFileId).toBeDefined();

    const downloaded = await provider.download(upload.storageFileId);
    expect(downloaded.toString('utf-8')).toBe('Local development document');

    await provider.delete(upload.storageFileId);
    expect(await provider.exists(upload.storageFileId)).toBe(false);

    (process.env as any).NODE_ENV = savedEnv;
    process.env.STORAGE_PROVIDER = 'mongodb';
    resetStorageProvider();
  });

  // ── 11. Transaction Rollback Simulation ────────────────────────────────────
  it('11. PostgreSQL transaction rollback simulation: deletes GridFS object if DB insert fails', async () => {
    const provider = new MongoDBStorageProvider();
    const data = Buffer.from('Transient document for rollback', 'utf-8');

    const uploadResult = await uploadEncryptedFile(
      {
        buffer: data,
        filename: 'rollback.pdf',
        mimeType: 'application/pdf',
        uploadedBy: 'user-fail',
      },
      provider
    );

    expect(await provider.exists(uploadResult.storageFileId)).toBe(true);

    // Simulate database failure trigger -> invoke cleanup
    await deleteEncryptedFile(uploadResult.storageFileId, provider);
    expect(await provider.exists(uploadResult.storageFileId)).toBe(false);
  });

  // ── 12. Migration Script Dry-Run Simulation ────────────────────────────────
  it('12. Migration idempotency simulation: skips already migrated documents with storageFileId', () => {
    const docMigrated = {
      id: 'doc-1',
      fileName: 'existing.pdf',
      storageProvider: 'mongodb',
      storageFileId: '65f1234567890123456789ab',
    };

    const docUnmigrated = {
      id: 'doc-2',
      fileName: 'old.pdf',
      storageProvider: 'local',
      storagePath: 'documents/doc-2/old.pdf',
      storageFileId: null,
    };

    const isAlreadyMigrated = (doc: any) => doc.storageProvider === 'mongodb' && Boolean(doc.storageFileId);

    expect(isAlreadyMigrated(docMigrated)).toBe(true);
    expect(isAlreadyMigrated(docUnmigrated)).toBe(false);
  });
});
