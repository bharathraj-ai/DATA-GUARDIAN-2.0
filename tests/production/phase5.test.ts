/**
 * Phase 5 — fail-closed scan, secret isolation, GridFS-only, forensic watermark.
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
process.env.AUDIT_HMAC_SECRET =
  process.env.AUDIT_HMAC_SECRET || 'test-audit-hmac-secret-min-32-chars!!!';
process.env.NEXTAUTH_SECRET =
  process.env.NEXTAUTH_SECRET || 'test-nextauth-secret-min-32-chars!!!!';
process.env.CRON_SECRET =
  process.env.CRON_SECRET || 'cron-secret-at-least-thirty-two-chars!!';

import { assertScanAllowed, type ScanResult } from '@/lib/security/malware-scan';
import { buildForensicWatermark } from '@/lib/security/forensic-watermark';
import { mintShareSession, verifyShareSession } from '@/lib/share-session';

describe('fail-closed malware gate', () => {
  it('rejects infected and error always', () => {
    expect(() =>
      assertScanAllowed({ status: 'infected', detail: 'eicar' }, 'bad.bin'),
    ).toThrow(/malware scan/);
    expect(() =>
      assertScanAllowed({ status: 'error', detail: 'timeout' }, 'x.pdf'),
    ).toThrow(/scanner failed/);
  });

  it('allows clean', () => {
    expect(() => assertScanAllowed({ status: 'clean' }, 'ok.pdf')).not.toThrow();
  });

  it('blocks non-clean statuses when NODE_ENV is production', () => {
    const prev = process.env.NODE_ENV;
    (process.env as { NODE_ENV?: string }).NODE_ENV = 'production';
    try {
      const pending: ScanResult = { status: 'pending' };
      const skipped: ScanResult = { status: 'skipped' };
      expect(() => assertScanAllowed(pending, 'a.pdf')).toThrow(/cleanly/);
      expect(() => assertScanAllowed(skipped, 'a.pdf')).toThrow(/cleanly/);
    } finally {
      (process.env as { NODE_ENV?: string }).NODE_ENV = prev;
    }
  });
});

describe('AUDIT_HMAC_SECRET strict requirement', () => {
  const original = { ...process.env };

  afterEach(() => {
    process.env = { ...original };
    (process.env as { NODE_ENV?: string }).NODE_ENV = 'test';
  });

  it('requires dedicated AUDIT_HMAC_SECRET in strict mode', async () => {
    process.env.ENCRYPTION_KEY =
      '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
    process.env.KEK_KEY =
      'fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210';
    process.env.OTP_HMAC_SECRET = 'otp-secret-at-least-thirty-two-chars!!';
    process.env.SESSION_HMAC_SECRET = 'session-secret-at-least-thirty-two-ch';
    process.env.NEXTAUTH_SECRET = 'nextauth-secret-at-least-thirty-two-c';
    process.env.CRON_SECRET = 'cron-secret-at-least-thirty-two-chars!!';
    process.env.UPSTASH_REDIS_REST_URL = 'https://example.upstash.io';
    process.env.UPSTASH_REDIS_REST_TOKEN = 'token';
    delete process.env.AUDIT_HMAC_SECRET;
    const { collectSecretIssues } = await import('@/lib/security/env-validation');
    const issues = collectSecretIssues({ strict: true });
    expect(issues.some((i) => i.includes('AUDIT_HMAC_SECRET'))).toBe(true);
  });
});

describe('share-session MAC uses SESSION_HMAC_SECRET only', () => {
  it('source does not accept NEXTAUTH_SECRET as MAC key', () => {
    const fs = require('fs') as typeof import('fs');
    const path = require('path') as typeof import('path');
    const src = fs.readFileSync(
      path.join(process.cwd(), 'src/lib/share-session.ts'),
      'utf8',
    );
    expect(src).not.toMatch(/NEXTAUTH_SECRET/);

    const session = mintShareSession('tok-phase5', 600, 'vendor@example.com');
    const verified = verifyShareSession(session.cookieValue, 'tok-phase5');
    expect(verified.valid).toBe(true);
    if (verified.valid) {
      expect(verified.sessionId).toBe(session.sessionId);
    }
  });
});

describe('forensic watermark', () => {
  it('embeds email, token fragment, device, and timestamp', () => {
    const parts = buildForensicWatermark({
      viewerEmail: 'Ada@Corp.com',
      token: 'abcdefghijklmnop',
      deviceHash: 'deadbeefcafebabe',
      at: new Date('2026-08-23T12:00:00.000Z'),
    });
    expect(parts.email).toBe('Ada@Corp.com');
    expect(parts.tokenFragment).toBe('abcdefgh');
    expect(parts.deviceFragment).toBe('deadbeef');
    expect(parts.line).toContain('Ada@Corp.com');
    expect(parts.line).toContain('abcdefgh');
    expect(parts.line).toContain('deadbeef');
    expect(parts.line).toContain('2026-08-23T12:00:00Z');
  });
});

describe('no-S3 / GridFS-only posture', () => {
  it('blob-store and package.json have no S3 client', async () => {
    const fs = await import('fs/promises');
    const path = await import('path');
    const blob = await fs.readFile(
      path.join(process.cwd(), 'src/lib/blob-store.ts'),
      'utf8',
    );
    const pkg = await fs.readFile(path.join(process.cwd(), 'package.json'), 'utf8');
    expect(blob).toMatch(/GridFS|gridfs/);
    expect(blob).not.toMatch(/s3Put|@\/lib\/s3|@aws-sdk\/client-s3/);
    expect(pkg).not.toMatch(/@aws-sdk\/client-s3/);
    expect(pkg).not.toMatch(/"minio"/);
  });

  it('SecurityShield documents capture limits (not absolute prevention)', async () => {
    const fs = await import('fs/promises');
    const path = await import('path');
    const src = await fs.readFile(
      path.join(process.cwd(), 'src/components/view/SecurityShield.tsx'),
      'utf8',
    );
    expect(src).toMatch(/absolute screenshot prevention/);
    expect(src).toMatch(/phone cameras/);
    expect(src).toMatch(/forensic-watermark/);
    expect(src).toMatch(/idle-timeout/);
    expect(src).toMatch(/getDisplayMedia/);
  });

  it('landing claims detection and forensic watermark, not absolute block', async () => {
    const fs = await import('fs/promises');
    const path = await import('path');
    const src = await fs.readFile(path.join(process.cwd(), 'src/app/page.tsx'), 'utf8');
    expect(src).toMatch(/Screenshot Detection & Forensic Watermark/);
    expect(src).toMatch(/GridFS/);
    expect(src).not.toMatch(/cannot take screenshots/i);
  });
});
