/**
 * Production-readiness contracts: auth ACL, SSE access, login RL, failure modes.
 */

process.env.ENCRYPTION_KEY =
  process.env.ENCRYPTION_KEY ||
  '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
process.env.SESSION_HMAC_SECRET =
  process.env.SESSION_HMAC_SECRET || 'test-session-hmac-secret-min-32-chars!!';
process.env.OTP_HMAC_SECRET =
  process.env.OTP_HMAC_SECRET || 'test-otp-hmac-secret-min-32-chars!!!!';
process.env.NEXTAUTH_SECRET = process.env.NEXTAUTH_SECRET || 'test-nextauth-secret';

describe('trySseAccessCheck fail-closed / fail-open semantics', () => {
  beforeEach(() => {
    jest.resetModules();
    delete process.env.UPSTASH_REDIS_REST_URL;
    delete process.env.UPSTASH_REDIS_REST_TOKEN;
  });

  it('returns ok when Redis is not configured', async () => {
    const { trySseAccessCheck } = await import('@/lib/redis-helpers');
    await expect(trySseAccessCheck('tok', 'sess')).resolves.toBe('ok');
  });

  it('maps unknown cache miss to ok (signed cookie remains authoritative)', async () => {
    process.env.UPSTASH_REDIS_REST_URL = 'https://example.upstash.io';
    process.env.UPSTASH_REDIS_REST_TOKEN = 'test-token';
    jest.doMock('@/lib/redis', () => ({
      checkSseAccess: jest.fn().mockResolvedValue('unknown'),
    }));
    const { trySseAccessCheck } = await import('@/lib/redis-helpers');
    await expect(trySseAccessCheck('tok', 'sess')).resolves.toBe('ok');
  });

  it('returns revoked / invalid when Redis answers', async () => {
    process.env.UPSTASH_REDIS_REST_URL = 'https://example.upstash.io';
    process.env.UPSTASH_REDIS_REST_TOKEN = 'test-token';
    const checkSseAccess = jest
      .fn()
      .mockResolvedValueOnce('revoked')
      .mockResolvedValueOnce('invalid');
    jest.doMock('@/lib/redis', () => ({ checkSseAccess }));
    const { trySseAccessCheck } = await import('@/lib/redis-helpers');
    await expect(trySseAccessCheck('tok', 'sess')).resolves.toBe('revoked');
    await expect(trySseAccessCheck('tok', 'sess')).resolves.toBe('invalid');
  });

  it('fails closed to revoked when Redis throws', async () => {
    process.env.UPSTASH_REDIS_REST_URL = 'https://example.upstash.io';
    process.env.UPSTASH_REDIS_REST_TOKEN = 'test-token';
    jest.doMock('@/lib/redis', () => ({
      checkSseAccess: jest.fn().mockRejectedValue(new Error('redis down')),
    }));
    const { trySseAccessCheck } = await import('@/lib/redis-helpers');
    await expect(trySseAccessCheck('tok', 'sess')).resolves.toBe('revoked');
  });
});

describe('checkLoginRateLimit', () => {
  it('allows first attempts via memory fallback when Redis is absent', async () => {
    jest.resetModules();
    delete process.env.UPSTASH_REDIS_REST_URL;
    delete process.env.UPSTASH_REDIS_REST_TOKEN;
    const { checkLoginRateLimit } = await import('@/lib/rate-limit');
    const first = await checkLoginRateLimit('203.0.113.10');
    expect(first.allowed).toBe(true);
    expect(first.usedMemoryFallback).toBe(true);
  });
});

describe('production source contracts', () => {
  it('NextAuth POST is rate-limited', async () => {
    const fs = await import('fs/promises');
    const path = await import('path');
    const src = await fs.readFile(
      path.join(process.cwd(), 'src/app/api/auth/[...nextauth]/route.ts'),
      'utf8',
    );
    expect(src).toMatch(/checkLoginRateLimit/);
    expect(src).toMatch(/status:\s*429/);
  });

  it('SSE presence upserts a deterministic DocumentSession id', async () => {
    const fs = await import('fs/promises');
    const path = await import('path');
    const src = await fs.readFile(
      path.join(process.cwd(), 'src/app/api/stream/[token]/route.ts'),
      'utf8',
    );
    expect(src).toMatch(/documentSession\.upsert/);
    expect(src).toMatch(/sse:\$\{sessionId\}/);
    expect(src).not.toMatch(/documentSession\.create\(/);
  });

  it('getFullUserData uses authorizeSecureLink and owner gate', async () => {
    const fs = await import('fs/promises');
    const path = await import('path');
    const src = await fs.readFile(
      path.join(process.cwd(), 'src/actions/get-user.ts'),
      'utf8',
    );
    expect(src).toMatch(/authorizeSecureLink\(token, 'view'/);
    expect(src).toMatch(/!authResult\.context\.isOwner/);
    expect(src).not.toMatch(/tryCheckRevoked/);
  });

  it('instrumentation loads Node-only work only when NEXT_RUNTIME is nodejs', async () => {
    const fs = await import('fs/promises');
    const path = await import('path');
    const hook = await fs.readFile(
      path.join(process.cwd(), 'src/instrumentation.ts'),
      'utf8',
    );
    expect(hook).toMatch(/process\.env\.NEXT_RUNTIME === ['"]nodejs['"]/);
    expect(hook).toMatch(/import\(['"]\.\/instrumentation-node['"]\)/);
    expect(hook).not.toMatch(/['"]@?\/?.*mongo\/client['"]/);
    expect(hook).not.toMatch(/['"]dns\/promises['"]/);
  });

  it('Vercel instrumentation skips in-process cleanup', async () => {
    const fs = await import('fs/promises');
    const path = await import('path');
    const src = await fs.readFile(
      path.join(process.cwd(), 'src/instrumentation-node.ts'),
      'utf8',
    );
    expect(src).toMatch(/process\.env\.VERCEL/);
    expect(src).toMatch(/cron \/api\/cleanup/);
  });

  it('sudden-exit and cleanup do not leak internal errors', async () => {
    const fs = await import('fs/promises');
    const path = await import('path');
    const sudden = await fs.readFile(
      path.join(process.cwd(), 'src/app/api/session/sudden-exit/route.ts'),
      'utf8',
    );
    const cleanup = await fs.readFile(
      path.join(process.cwd(), 'src/app/api/cleanup/route.ts'),
      'utf8',
    );
    expect(sudden).toMatch(/Sudden exit failed/);
    expect(sudden).not.toMatch(/error: result\.error/);
    expect(cleanup).toMatch(/Cleanup failed/);
    expect(cleanup).not.toMatch(/error: result\.error/);
  });

  it('Dockerfile readiness probe hits /api/health?ready=1', async () => {
    const fs = await import('fs/promises');
    const path = await import('path');
    const src = await fs.readFile(path.join(process.cwd(), 'Dockerfile'), 'utf8');
    expect(src).toMatch(/\/api\/health\?ready=1/);
  });

  it('revoke returns before data cleanup (after())', async () => {
    const fs = await import('fs/promises');
    const path = await import('path');
    const src = await fs.readFile(
      path.join(process.cwd(), 'src/actions/revoke-access.ts'),
      'utf8',
    );
    expect(src).toMatch(/from 'next\/server'/);
    expect(src).toMatch(/runAfterResponse/);
    const fnStart = src.indexOf('export async function revokeAccess');
    const fnSlice = src.slice(fnStart, src.indexOf('export async function getLinkStatus'));
    expect(fnSlice).toMatch(/runAfterResponse/);
    const withoutAfter = fnSlice.replace(/runAfterResponse\([\s\S]*?\}\);/g, '');
    expect(withoutAfter).not.toMatch(/executeSingleLinkCleanup/);
  });

  it('break returns before OTP email (after())', async () => {
    const fs = await import('fs/promises');
    const path = await import('path');
    const src = await fs.readFile(
      path.join(process.cwd(), 'src/actions/break-session.ts'),
      'utf8',
    );
    expect(src).toMatch(/from 'next\/server'/);
    expect(src).toMatch(/runAfterResponse/);
    const emailIdx = src.indexOf('sendOTPEmail(');
    const afterIdx = src.indexOf('runAfterResponse');
    expect(emailIdx).toBeGreaterThan(afterIdx);
  });

  it('GridFS upload uses 1MiB chunks and skips post-upload checksum update', async () => {
    const fs = await import('fs/promises');
    const path = await import('path');
    const ops = await fs.readFile(
      path.join(process.cwd(), 'src/lib/mongo/operations.ts'),
      'utf8',
    );
    const client = await fs.readFile(
      path.join(process.cwd(), 'src/lib/mongo/client.ts'),
      'utf8',
    );
    expect(client).toMatch(/GRIDFS_CHUNK_SIZE/);
    expect(ops).toMatch(/chunkSizeBytes:\s*GRIDFS_CHUNK_SIZE/);
    expect(ops).not.toMatch(/fs\.files/);
  });
});

describe('gridFsIdForFile', () => {
  it('returns id only for live GridFS rows', async () => {
    const { gridFsIdForFile } = await import('@/lib/security/resource-ownership');
    expect(gridFsIdForFile({ mongoFile: null })).toBeNull();
    expect(gridFsIdForFile({ mongoFile: { gridFSId: 'abc', isDeleted: true } })).toBeNull();
    expect(gridFsIdForFile({ mongoFile: { gridFSId: 'abc', isDeleted: false } })).toBe('abc');
  });
});
