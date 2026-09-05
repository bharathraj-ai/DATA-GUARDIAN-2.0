/**
 * Phase 1 production-stability contracts.
 */

process.env.ENCRYPTION_KEY =
  process.env.ENCRYPTION_KEY ||
  '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
process.env.KEK_KEY =
  process.env.KEK_KEY ||
  'fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210';
process.env.OTP_HMAC_SECRET =
  process.env.OTP_HMAC_SECRET || 'test-otp-hmac-secret-min-32-chars!!!!';
process.env.SESSION_HMAC_SECRET =
  process.env.SESSION_HMAC_SECRET || 'test-session-hmac-secret-min-32-chars!!';
process.env.NEXTAUTH_SECRET =
  process.env.NEXTAUTH_SECRET || 'test-nextauth-secret-min-32-chars!!!!';
process.env.CRON_SECRET =
  process.env.CRON_SECRET || 'cron-secret-at-least-thirty-two-chars!!';
process.env.AUDIT_HMAC_SECRET =
  process.env.AUDIT_HMAC_SECRET || 'test-audit-hmac-secret-min-32-chars!!!';

describe('collectSecretIssues', () => {
  const original = { ...process.env };

  afterEach(() => {
    process.env = { ...original };
    (process.env as { NODE_ENV?: string }).NODE_ENV = 'test';
  });

  it('flags identical KEK and ENCRYPTION_KEY even when not strict', async () => {
    const same = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
    process.env.ENCRYPTION_KEY = same;
    process.env.KEK_KEY = same;
    const { collectSecretIssues } = await import('@/lib/security/env-validation');
    expect(collectSecretIssues({ strict: false })).toEqual(
      expect.arrayContaining(['KEK_KEY must not equal ENCRYPTION_KEY']),
    );
  });

  it('requires distinct HMAC secrets and Redis in strict mode', async () => {
    process.env.ENCRYPTION_KEY =
      '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
    process.env.KEK_KEY =
      'fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210';
    process.env.OTP_HMAC_SECRET = 'otp-secret-at-least-thirty-two-chars!!';
    process.env.SESSION_HMAC_SECRET = 'session-secret-at-least-thirty-two-ch';
    process.env.NEXTAUTH_SECRET = 'nextauth-secret-at-least-thirty-two-c';
    process.env.CRON_SECRET = 'cron-secret-at-least-thirty-two-chars!!';
    delete process.env.AUDIT_HMAC_SECRET;
    delete process.env.UPSTASH_REDIS_REST_URL;
    delete process.env.UPSTASH_REDIS_REST_TOKEN;
    const { collectSecretIssues } = await import('@/lib/security/env-validation');
    const issues = collectSecretIssues({ strict: true });
    expect(issues.some((i) => i.includes('UPSTASH_REDIS_REST_URL'))).toBe(true);
    expect(issues.some((i) => i.includes('UPSTASH_REDIS_REST_TOKEN'))).toBe(true);
    expect(issues.some((i) => i.includes('AUDIT_HMAC_SECRET'))).toBe(true);
  });

  it('passes when production secrets are present and distinct', async () => {
    process.env.ENCRYPTION_KEY =
      '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
    process.env.KEK_KEY =
      'fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210';
    process.env.OTP_HMAC_SECRET = 'otp-secret-at-least-thirty-two-chars!!';
    process.env.SESSION_HMAC_SECRET = 'session-secret-at-least-thirty-two-ch';
    process.env.NEXTAUTH_SECRET = 'nextauth-secret-at-least-thirty-two-c';
    process.env.CRON_SECRET = 'cron-secret-at-least-thirty-two-chars!!';
    process.env.AUDIT_HMAC_SECRET = 'audit-secret-at-least-thirty-two-chars!';
    process.env.UPSTASH_REDIS_REST_URL = 'https://example.upstash.io';
    process.env.UPSTASH_REDIS_REST_TOKEN = 'token';
    const { collectSecretIssues } = await import('@/lib/security/env-validation');
    expect(collectSecretIssues({ strict: true })).toEqual([]);
  });
});

describe('phase-1 source contracts', () => {
  it('create-link does not fail-open the upload rate limit after 50ms', async () => {
    const fs = await import('fs/promises');
    const path = await import('path');
    const src = await fs.readFile(
      path.join(process.cwd(), 'src/actions/create-link-with-files.ts'),
      'utf8',
    );
    expect(src).toMatch(/await checkUploadRateLimit\(clientIP\)/);
    expect(src).not.toMatch(/Promise\.race/);
    expect(src).not.toMatch(/allowed:\s*true/);
  });

  it('FileVersion snapshots persist encryptedDek and restore copies it back', async () => {
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
    const replace = await fs.readFile(
      path.join(process.cwd(), 'src/app/api/documents/[fileId]/replace-page/route.ts'),
      'utf8',
    );
    expect(save).toMatch(/encryptedDekStr|encryptedDek/);
    expect(versions).toMatch(/encryptedDek:\s*version\.encryptedDek/);
    expect(versions).toMatch(/missing its encryption key/);
    expect(replace).toMatch(/encryptedDek/);
  });

  it('global cleanup reaps stale GridFS staging objects', async () => {
    const fs = await import('fs/promises');
    const path = await import('path');
    const cleanup = await fs.readFile(
      path.join(process.cwd(), 'src/lib/cleanup-core.ts'),
      'utf8',
    );
    const stage = await fs.readFile(
      path.join(process.cwd(), 'src/lib/create-link-stage.ts'),
      'utf8',
    );
    expect(stage).toMatch(/export async function reapStaleStagedFiles/);
    expect(stage).toMatch(/LINK_STAGING_FOLDER/);
    expect(cleanup).toMatch(/reapStaleStagedFiles/);
    expect(cleanup).toMatch(/deletedStaleStaging/);
  });

  it('production instrumentation asserts secrets and inits Sentry', async () => {
    const fs = await import('fs/promises');
    const path = await import('path');
    const node = await fs.readFile(
      path.join(process.cwd(), 'src/instrumentation-node.ts'),
      'utf8',
    );
    const hook = await fs.readFile(
      path.join(process.cwd(), 'src/instrumentation.ts'),
      'utf8',
    );
    expect(node).toMatch(/assertRuntimeSecrets/);
    expect(node).toMatch(/initSentry/);
    expect(hook).toMatch(/onRequestError/);
    expect(hook).toMatch(/captureException/);
  });

  it('OTP hashing no longer falls back to ENCRYPTION_KEY', async () => {
    const fs = await import('fs/promises');
    const path = await import('path');
    const src = await fs.readFile(path.join(process.cwd(), 'src/lib/crypto.ts'), 'utf8');
    expect(src).toMatch(/OTP_HMAC_SECRET is required for OTP hashing/);
    expect(src).not.toMatch(/OTP_HMAC_SECRET \|\| process\.env\.ENCRYPTION_KEY/);
  });
});
