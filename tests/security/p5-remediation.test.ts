import { getStorageRoot } from '@/lib/storage/secureStorage';
import { generateCspNonce, buildCspHeader } from '@/lib/security/csp';
import { tryCheckRevoked, trySseAccessCheck } from '@/lib/redis-helpers';
import { sanitizeLogString, redactSensitiveData, logger } from '@/lib/logger';
import { completeWork } from '@/actions/complete-work';
import { prisma } from '@/lib/prisma';
import { authorizeSecureLink } from '@/lib/linkAuthorization';

jest.mock('@/lib/prisma', () => ({
  prisma: {
    secureLink: {
      findUnique: jest.fn(),
      updateMany: jest.fn(),
      update: jest.fn(),
    },
    vendorAccess: {
      updateMany: jest.fn(),
    },
    linkAccess: {
      updateMany: jest.fn(),
    },
    userFile: {
      updateMany: jest.fn(),
    },
    auditLog: {
      create: jest.fn(),
    },
  },
}));

jest.mock('@/lib/linkAuthorization', () => ({
  authorizeSecureLink: jest.fn(),
}));

jest.mock('@/lib/redis', () => ({
  __esModule: true,
  default: {},
  isTokenRevoked: jest.fn(),
  checkSseAccess: jest.fn(),
  invalidateSession: jest.fn(),
}));

jest.mock('@/lib/email', () => ({
  sendCompletedWorkEmail: jest.fn().mockResolvedValue({ success: true }),
}));

jest.mock('@/lib/send-record', () => ({
  stampSendRecord: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('@/lib/cleanup-core', () => ({
  executeSingleLinkCleanup: jest.fn().mockResolvedValue({ success: true }),
}));

describe('P5 Security Remediation Tests', () => {
  const origEnv = { ...process.env };

  afterEach(() => {
    jest.clearAllMocks();
  });

  afterAll(() => {
    process.env = origEnv;
  });

  // ========================================================
  // P5-01: Storage Root & NFT Exclusions
  // ========================================================
  describe('P5-01: Persistent Storage Root Isolation', () => {
    it('defaults to /app/storage-vault in production container environment', () => {
      delete process.env.SECURE_STORAGE_PATH;
      const originalNodeEnv = process.env.NODE_ENV;
      try {
        (process.env as any).NODE_ENV = 'production';
        const root = getStorageRoot();
        expect(root).toBe('/app/storage-vault');
      } finally {
        (process.env as any).NODE_ENV = originalNodeEnv;
      }
    });

    it('respects explicitly configured SECURE_STORAGE_PATH environment variable', () => {
      process.env.SECURE_STORAGE_PATH = '/custom/isolated/vault';
      expect(getStorageRoot()).toBe('/custom/isolated/vault');
      delete process.env.SECURE_STORAGE_PATH;
    });
  });

  // ========================================================
  // P5-02: Next.js 16 CSP Hydration & Nonce Validation
  // ========================================================
  describe('P5-02: Content Security Policy & Nonce Generation', () => {
    it('generates a cryptographically secure 16-byte base64 nonce', () => {
      const nonce1 = generateCspNonce();
      const nonce2 = generateCspNonce();
      expect(nonce1).toBeDefined();
      expect(nonce2).toBeDefined();
      expect(nonce1).not.toBe(nonce2);
      expect(Buffer.from(nonce1, 'base64').length).toBe(16);
    });

    it('builds strict production CSP with matching nonce, strict-dynamic, and NO unsafe-inline', () => {
      const nonce = generateCspNonce();
      const csp = buildCspHeader(nonce, { isDev: false, pathname: '/' });

      // Must have strict nonce
      expect(csp).toContain(`'nonce-${nonce}'`);
      // Must have strict-dynamic
      expect(csp).toContain("'strict-dynamic'");
      // Must NOT have unsafe-inline in script-src
      const scriptSrcPart = csp.split(';').find((part) => part.trim().startsWith('script-src'));
      expect(scriptSrcPart).toBeDefined();
      expect(scriptSrcPart).not.toContain("'unsafe-inline'");

      // Critical protective directives
      expect(csp).toContain("frame-ancestors 'none'");
      expect(csp).toContain("object-src 'none'");
      expect(csp).toContain("base-uri 'self'");
      expect(csp).toContain("https://accounts.google.com");
    });

    it('includes ONLYOFFICE origin for editor routes', () => {
      const nonce = generateCspNonce();
      const csp = buildCspHeader(nonce, {
        isDev: false,
        pathname: '/editor/test-token',
        onlyOfficeServerUrl: 'https://office.example.com',
      });
      expect(csp).toContain('https://office.example.com');
    });
  });

  // ========================================================
  // P5-03: Redis Outage Resilience & Authoritative DB Fallback
  // ========================================================
  describe('P5-03: Redis Outage Resilience & Fallback', () => {
    beforeEach(() => {
      process.env.UPSTASH_REDIS_REST_URL = 'https://fake-redis.upstash.io';
      process.env.UPSTASH_REDIS_REST_TOKEN = 'fake-token-12345678';
    });

    it('tryCheckRevoked: falls back to PostgreSQL when Redis throws communication error and link is valid', async () => {
      const redis = require('@/lib/redis');
      redis.isTokenRevoked.mockRejectedValueOnce(new Error('Redis connection timeout'));

      (prisma.secureLink.findUnique as jest.Mock).mockResolvedValueOnce({
        isRevoked: false,
      });

      const result = await tryCheckRevoked('valid-token-123');

      // Crucial: Must NOT report revoked simply because Redis failed
      expect(result).toBe(false);
      expect(prisma.secureLink.findUnique).toHaveBeenCalledWith({
        where: { token: 'valid-token-123' },
        select: { isRevoked: true },
      });
    });

    it('tryCheckRevoked: reports true when PostgreSQL confirms link is revoked during Redis outage', async () => {
      const redis = require('@/lib/redis');
      redis.isTokenRevoked.mockRejectedValueOnce(new Error('ECONNREFUSED'));

      (prisma.secureLink.findUnique as jest.Mock).mockResolvedValueOnce({
        isRevoked: true,
      });

      const result = await tryCheckRevoked('revoked-token-456');

      expect(result).toBe(true);
    });

    it('trySseAccessCheck: returns ok for valid link when Redis errors out', async () => {
      const redis = require('@/lib/redis');
      redis.checkSseAccess.mockRejectedValueOnce(new Error('Redis cluster failover'));

      (prisma.secureLink.findUnique as jest.Mock).mockResolvedValueOnce({
        isRevoked: false,
        VendorAccess: [
          {
            activeSessionId: 'sess-abc',
            isRevoked: false,
          },
        ],
      });

      const result = await trySseAccessCheck('token-789', 'sess-abc');

      // Valid session continues operating through Redis blips
      expect(result).toBe('ok');
    });

    it('trySseAccessCheck: returns revoked when PostgreSQL confirms revocation during Redis outage', async () => {
      const redis = require('@/lib/redis');
      redis.checkSseAccess.mockRejectedValueOnce(new Error('Redis unavailable'));

      (prisma.secureLink.findUnique as jest.Mock).mockResolvedValueOnce({
        isRevoked: true,
        VendorAccess: [],
      });

      const result = await trySseAccessCheck('token-revoked', 'sess-xyz');

      expect(result).toBe('revoked');
    });
  });

  // ========================================================
  // P5-04: Production Logging & Secret Redaction
  // ========================================================
  describe('P5-04: Production Logging & Comprehensive Redaction', () => {
    beforeEach(() => {
      process.env.ENCRYPTION_KEY = 'super-secret-encryption-key-value-32';
      process.env.KEK_KEY = 'super-secret-kek-key-value-32-chars';
      process.env.OTP_HMAC_SECRET = 'super-secret-otp-hmac-secret-min32';
      process.env.SESSION_HMAC_SECRET = 'super-secret-session-hmac-secret-min32';
      process.env.NEXTAUTH_SECRET = 'super-secret-nextauth-secret-min32';
      process.env.UPSTASH_REDIS_REST_TOKEN = 'super-secret-upstash-redis-token';
      process.env.CRON_SECRET = 'super-secret-cron-token-value-32';
    });

    it('redacts literal ENCRYPTION_KEY and KEK_KEY from log strings', () => {
      const raw = `Error occurred with key: ${process.env.ENCRYPTION_KEY} and kek: ${process.env.KEK_KEY}`;
      const sanitized = sanitizeLogString(raw);

      expect(sanitized).not.toContain(process.env.ENCRYPTION_KEY!);
      expect(sanitized).not.toContain(process.env.KEK_KEY!);
      expect(sanitized).toContain('[REDACTED_SECRET]');
    });

    it('redacts database passwords in connection URLs', () => {
      const raw = 'Connected to postgresql://admin:superSecretPass123!@db.neon.tech/main';
      const sanitized = sanitizeLogString(raw);

      expect(sanitized).not.toContain('superSecretPass123!');
      expect(sanitized).toContain('postgresql://admin:[REDACTED_PASSWORD]@');
    });

    it('redacts MongoDB connection credentials', () => {
      const raw = 'Connecting to mongodb+srv://dbuser:mongoPassSecret99@cluster0.mongodb.net/test';
      const sanitized = sanitizeLogString(raw);

      expect(sanitized).not.toContain('mongoPassSecret99');
      expect(sanitized).toContain('mongodb+srv://dbuser:[REDACTED_PASSWORD]@');
    });

    it('redacts Bearer tokens and session cookies', () => {
      const raw = 'Header: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9. Cookie: session_id=sess_abcdef123456';
      const sanitized = sanitizeLogString(raw);

      expect(sanitized).toContain('Bearer [REDACTED_TOKEN]');
      expect(sanitized).toContain('session_id=[REDACTED_SESSION]');
    });

    it('redacts sensitive object keys including DEK and Buffer in redactSensitiveData', () => {
      const data = {
        dek: 'secret-dek-hex-key',
        rawBuffer: Buffer.from('secret-data-encryption-key'),
        otp: '123456',
        password: 'user-pass',
        normalField: 'visible-metadata',
      };
      const redacted = redactSensitiveData(data) as any;

      expect(redacted.dek).toBe('[REDACTED_KEY]');
      expect(redacted.rawBuffer).toBe('[Buffer 26 bytes]');
      expect(redacted.otp).toBe('[REDACTED_OTP]');
      expect(redacted.password).toBe('[REDACTED_PASSWORD]');
      expect(redacted.normalField).toBe('visible-metadata');
    });

    it('logger.info outputs directly to stdout', () => {
      const stdoutSpy = jest.spyOn(process.stdout, 'write').mockImplementation(() => true);
      logger.info('Test operational flow message', { action: 'TEST_EVENT' });

      expect(stdoutSpy).toHaveBeenCalled();
      const logged = stdoutSpy.mock.calls[0][0] as string;
      expect(logged).toContain('[INFO]');
      expect(logged).toContain('Test operational flow message');
      stdoutSpy.mockRestore();
    });
  });

  // ========================================================
  // P5-05: Complete Work Authorization & Idempotency
  // ========================================================
  describe('P5-05: Complete Work Authorization & Idempotency', () => {
    it('allows Link Owner to complete work', async () => {
      (authorizeSecureLink as jest.Mock).mockResolvedValueOnce({
        success: true,
        context: {
          isOwner: true,
          vendorAccess: null,
          effectiveEmail: 'owner@example.com',
          secureLink: {
            id: 'link-owner-1',
            ownerId: 'owner-id',
            notificationEmail: 'owner@example.com',
            allowEditing: false,
            UserFile: [],
          },
        },
      });

      (prisma.secureLink.updateMany as jest.Mock).mockResolvedValueOnce({ count: 1 });

      const result = await completeWork('token-owner');

      expect(result.success).toBe(true);
      expect(prisma.secureLink.updateMany).toHaveBeenCalledWith({
        where: { id: 'link-owner-1', isRevoked: false },
        data: { isRevoked: true },
      });
    });

    it('allows Level 1 Team Leader to complete work', async () => {
      (authorizeSecureLink as jest.Mock).mockResolvedValueOnce({
        success: true,
        context: {
          isOwner: false,
          vendorAccess: { level: 1, isRevoked: false },
          effectiveEmail: 'leader@vendor.com',
          secureLink: {
            id: 'link-leader-1',
            ownerId: 'owner-id',
            notificationEmail: 'owner@example.com',
            allowEditing: false,
            UserFile: [],
          },
        },
      });

      (prisma.secureLink.updateMany as jest.Mock).mockResolvedValueOnce({ count: 1 });

      const result = await completeWork('token-leader');

      expect(result.success).toBe(true);
    });

    it('rejects Level 2 participant with 403 Forbidden', async () => {
      (authorizeSecureLink as jest.Mock).mockResolvedValueOnce({
        success: true,
        context: {
          isOwner: false,
          vendorAccess: { level: 2, isRevoked: false },
          effectiveEmail: 'member@vendor.com',
          secureLink: {
            id: 'link-member-2',
            ownerId: 'owner-id',
            allowEditing: true,
          },
        },
      });

      const result = await completeWork('token-member');

      // Crucial: Level 2 participant MUST NOT finalize work or trigger cleanup
      expect(result.success).toBe(false);
      expect(result.error).toContain('Forbidden: Only the Team Leader (Level 1) or Link Owner');
      expect(prisma.secureLink.updateMany).not.toHaveBeenCalled();
    });

    it('is idempotent: returns success when link is already revoked/finalized', async () => {
      (authorizeSecureLink as jest.Mock).mockResolvedValueOnce({
        success: false,
        status: 403,
        error: 'Forbidden: Access revoked',
      });

      (prisma.secureLink.findUnique as jest.Mock).mockResolvedValueOnce({
        isRevoked: true,
      });

      const result = await completeWork('token-already-revoked');

      expect(result.success).toBe(true);
    });

    it('handles concurrent finalize requests safely without duplicate cleanup', async () => {
      (authorizeSecureLink as jest.Mock).mockResolvedValueOnce({
        success: true,
        context: {
          isOwner: true,
          vendorAccess: null,
          effectiveEmail: 'owner@example.com',
          secureLink: {
            id: 'link-concurrent',
            ownerId: 'owner-id',
            allowEditing: false,
            UserFile: [],
          },
        },
      });

      // Count 0 means a competing concurrent request already marked it revoked
      (prisma.secureLink.updateMany as jest.Mock).mockResolvedValueOnce({ count: 0 });

      const result = await completeWork('token-concurrent');

      expect(result.success).toBe(true);
    });
  });
});
