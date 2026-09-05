/**
 * Phase 3 performance-scaling contracts.
 */

import {
  blobStoreEnabled,
  gridFsIdFromStorageKey,
  storageKeyForGridFs,
  storageKeyForPointer,
} from '@/lib/blob-store';
import { SSE_POLL_MS } from '@/lib/sse-poll';
import { isMarketingPath } from '@/lib/marketing-paths';

describe('object storage keys', () => {
  it('round-trips GridFS ids and rejects junk', () => {
    const id = '507f1f77bcf86cd799439011';
    const key = storageKeyForGridFs(id);
    expect(gridFsIdFromStorageKey(key)).toBe(id);
    expect(gridFsIdFromStorageKey('s3://nope')).toBeNull();
    expect(gridFsIdFromStorageKey('gridfs:not-an-oid')).toBeNull();
    expect(storageKeyForPointer(id)).toBe(key);
    expect(storageKeyForPointer(key)).toBe(key);
    expect(storageKeyForPointer('s3:whatever')).toBeNull();
  });

  it('disables the blob store during tests unless forced', () => {
    expect(process.env.NODE_ENV).toBe('test');
    expect(blobStoreEnabled()).toBe(false);
  });
});

describe('SSE poll interval', () => {
  it('is slower than the old 3s Redis loop', () => {
    expect(SSE_POLL_MS).toBeGreaterThanOrEqual(8_000);
  });
});

describe('marketing path isolation', () => {
  it('treats landing and legal pages as marketing', () => {
    expect(isMarketingPath('/')).toBe(true);
    expect(isMarketingPath('/services')).toBe(true);
    expect(isMarketingPath('/how-it-works')).toBe(true);
    expect(isMarketingPath('/legal/privacy')).toBe(true);
    expect(isMarketingPath('/dashboard/owner')).toBe(false);
    expect(isMarketingPath('/view/abc')).toBe(false);
  });
});

describe('phase-3 source contracts', () => {
  it('FileVersion snapshots use storageKey instead of copying BYTEA when possible', async () => {
    const fs = await import('fs/promises');
    const path = await import('path');
    const save = await fs.readFile(
      path.join(process.cwd(), 'src/app/api/documents/[fileId]/save/route.ts'),
      'utf8',
    );
    const versions = await fs.readFile(
      path.join(process.cwd(), 'src/app/api/documents/[fileId]/versions/route.ts'),
      'utf8',
    );
    const store = await fs.readFile(
      path.join(process.cwd(), 'src/lib/file-version-store.ts'),
      'utf8',
    );
    expect(save).toMatch(/buildVersionSnapshot/);
    expect(save).toMatch(/application\/octet-stream/);
    expect(save).toMatch(/multipart\/form-data/);
    expect(versions).toMatch(/loadVersionCiphertext/);
    expect(versions).toMatch(/missing its encryption key/);
    expect(store).toMatch(/storageKey/);
    expect(store).not.toMatch(/encryptedContent:\s*file\.encryptedContent/);
  });

  it('root layout does not wrap marketing pages in SessionProvider', async () => {
    const fs = await import('fs/promises');
    const path = await import('path');
    const layout = await fs.readFile(
      path.join(process.cwd(), 'src/app/layout.tsx'),
      'utf8',
    );
    const gate = await fs.readFile(
      path.join(process.cwd(), 'src/components/AppSessionGate.tsx'),
      'utf8',
    );
    expect(layout).toMatch(/AppSessionGate/);
    expect(layout).not.toMatch(/<Providers>/);
    expect(gate).toMatch(/isMarketingPath/);
    expect(gate).toMatch(/<Providers>/);
  });

  it('OTP emails are enqueued on a durable job table', async () => {
    const fs = await import('fs/promises');
    const path = await import('path');
    const create = await fs.readFile(
      path.join(process.cwd(), 'src/actions/create-link-with-files.ts'),
      'utf8',
    );
    const jobs = await fs.readFile(
      path.join(process.cwd(), 'src/lib/jobs.ts'),
      'utf8',
    );
    const cleanup = await fs.readFile(
      path.join(process.cwd(), 'src/lib/cleanup-core.ts'),
      'utf8',
    );
    expect(create).toMatch(/enqueueOtpEmails/);
    expect(jobs).toMatch(/otp_email/);
    expect(cleanup).toMatch(/processDueJobs/);
  });

  it('SSE routes use SSE_POLL_MS instead of a 3s interval', async () => {
    const fs = await import('fs/promises');
    const path = await import('path');
    const stream = await fs.readFile(
      path.join(process.cwd(), 'src/app/api/stream/[token]/route.ts'),
      'utf8',
    );
    const monitor = await fs.readFile(
      path.join(process.cwd(), 'src/app/api/session-monitor/route.ts'),
      'utf8',
    );
    expect(stream).toMatch(/SSE_POLL_MS/);
    expect(stream).not.toMatch(/}, 3000\)/);
    expect(monitor).toMatch(/SSE_POLL_MS/);
    expect(monitor).not.toMatch(/}, 3000\)/);
  });

  it('blob store uses GridFS and live downloads use object pointers', async () => {
    const fs = await import('fs/promises');
    const path = await import('path');
    const blob = await fs.readFile(path.join(process.cwd(), 'src/lib/blob-store.ts'), 'utf8');
    const stage = await fs.readFile(path.join(process.cwd(), 'src/lib/create-link-stage.ts'), 'utf8');
    const decrypt = await fs.readFile(path.join(process.cwd(), 'src/lib/decrypt-user-file.ts'), 'utf8');
    expect(blob).toMatch(/uploadToMongo/);
    expect(blob).toMatch(/putStagedCiphertext/);
    expect(blob).not.toMatch(/s3Put|prefersS3|@\/lib\/s3/);
    expect(stage).toMatch(/putStagedCiphertext/);
    expect(decrypt).toMatch(/downloadLiveObject/);
  });
});
