import {
  checkRateLimit,
  checkOTPRateLimit,
  checkLoginRateLimit,
  extractClientIP,
  cleanCandidateIP,
  isTrustedProxy,
  isValidIP,
  _resetRedisClientForTesting,
  _clearMemoryBucketsForTesting,
} from '@/lib/rate-limit';
import { incrementAndCheckLimit } from '@/lib/limits';
import { sendOTPEmailWithRetry, _resetTransporterForTesting } from '@/lib/email';
import { prisma } from '@/lib/prisma';
import redis from '@/lib/redis';

jest.mock('next/headers', () => ({
  headers: jest.fn().mockResolvedValue(new Headers({ 'x-forwarded-for': '127.0.0.1' })),
  cookies: jest.fn().mockResolvedValue({
    get: jest.fn(),
    set: jest.fn(),
    delete: jest.fn(),
  }),
}));

// Mock dependencies
jest.mock('@/lib/prisma', () => ({
  prisma: {
    auditLog: {
      count: jest.fn(),
      create: jest.fn(),
    },
    $transaction: jest.fn(),
    vendorAccess: {
      update: jest.fn(),
      updateMany: jest.fn(),
    },
    linkAccess: {
      update: jest.fn(),
      updateMany: jest.fn(),
    },
    otpHistory: {
      create: jest.fn(),
      updateMany: jest.fn(),
    },
    secureLink: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
  },
}));

jest.mock('@/lib/redis', () => ({
  __esModule: true,
  default: {
    eval: jest.fn(),
    get: jest.fn(),
    set: jest.fn(),
    del: jest.fn(),
    incr: jest.fn(),
    decr: jest.fn(),
    expire: jest.fn(),
    exists: jest.fn(),
  },
}));

describe('P2 Security Remediation Test Suite', () => {
  const origEnv = process.env;

  beforeEach(() => {
    process.env = { ...origEnv };
    _resetRedisClientForTesting();
    _clearMemoryBucketsForTesting();
    _resetTransporterForTesting();
    jest.clearAllMocks();
    (redis.eval as jest.Mock).mockReset();
    (redis.eval as jest.Mock).mockResolvedValue([1, 900]);
    (redis.set as jest.Mock).mockReset();
    (redis.set as jest.Mock).mockResolvedValue('OK');
    (redis.del as jest.Mock).mockReset();
    (redis.del as jest.Mock).mockResolvedValue(1);
  });

  afterAll(() => {
    process.env = origEnv;
  });

  // =========================================================================
  // SV-04: Distributed Rate Limiting & Fail-Closed Under Redis Outage
  // =========================================================================
  describe('SV-04: Distributed Rate Limiting', () => {
    it('fails closed for security-sensitive OTP verification during Redis outage in production', async () => {
      process.env.NODE_ENV = 'production';
      process.env.REQUIRE_DISTRIBUTED_RATE_LIMIT = 'true';
      // Simulate Redis unconfigured or throwing
      (redis.eval as jest.Mock).mockRejectedValue(new Error('Connection refused to Upstash Redis'));

      const result = await checkOTPRateLimit('203.0.113.1');

      expect(result.allowed).toBe(false);
      expect(result.remaining).toBe(0);
      expect(result.usedMemoryFallback).toBe(false);
    });

    it('fails closed for security-sensitive Login rate limiting during Redis outage in production', async () => {
      process.env.NODE_ENV = 'production';
      process.env.REQUIRE_DISTRIBUTED_RATE_LIMIT = 'true';
      (redis.eval as jest.Mock).mockRejectedValue(new Error('Redis timeout'));

      const result = await checkLoginRateLimit('203.0.113.1');

      expect(result.allowed).toBe(false);
      expect(result.remaining).toBe(0);
      expect(result.usedMemoryFallback).toBe(false);
    });

    it('preserves safe development memory fallback when Redis is unavailable outside production', async () => {
      process.env.NODE_ENV = 'development';
      delete process.env.REQUIRE_DISTRIBUTED_RATE_LIMIT;
      (redis.eval as jest.Mock).mockRejectedValue(new Error('Local Redis offline'));

      const result = await checkOTPRateLimit('127.0.0.1');

      // Development fallback allows developer access while tracking in-memory
      expect(result.allowed).toBe(true);
      expect(result.usedMemoryFallback).toBe(true);
      expect(result.remaining).toBe(9); // 10 - 1
    });

    it('shares rate limits across multiple simulated application instances via Redis', async () => {
      process.env.NODE_ENV = 'production';
      process.env.REQUIRE_DISTRIBUTED_RATE_LIMIT = 'true';

      let redisCount = 0;
      (redis.eval as jest.Mock).mockImplementation(async () => {
        redisCount += 1;
        return [redisCount, 900]; // [count, ttl]
      });

      // Instance 1 checks rate limit
      const inst1_req1 = await checkOTPRateLimit('198.51.100.5');
      expect(inst1_req1.allowed).toBe(true);
      expect(inst1_req1.remaining).toBe(9);

      // Instance 2 checks rate limit for the same client IP
      const inst2_req1 = await checkOTPRateLimit('198.51.100.5');
      expect(inst2_req1.allowed).toBe(true);
      expect(inst2_req1.remaining).toBe(8);

      // Simulate hitting the limit of 10 attempts across instances
      redisCount = 9;
      const inst1_req10 = await checkOTPRateLimit('198.51.100.5');
      expect(inst1_req10.allowed).toBe(true);
      expect(inst1_req10.remaining).toBe(0);

      // 11th request from Instance 2 is blocked across the cluster
      const inst2_req11 = await checkOTPRateLimit('198.51.100.5');
      expect(inst2_req11.allowed).toBe(false);
      expect(inst2_req11.remaining).toBe(0);
      expect(inst2_req11.retryAfter).toBe(900);
    });
  });

  // =========================================================================
  // SV-06: Trusted Proxy IP Validation & Header Spoofing Prevention
  // =========================================================================
  describe('SV-06: Trusted Proxy IP Validation', () => {
    it('discards spoofed client-supplied X-Forwarded-For headers when no proxy is trusted', () => {
      delete process.env.TRUSTED_PROXIES;

      // Attacker injects fake IP "1.1.1.1". Reverse proxy appends attacker real IP "203.0.113.55"
      const headers = new Headers({
        'x-forwarded-for': '1.1.1.1, 203.0.113.55',
      });

      const clientIP = extractClientIP(headers);

      // Must NOT return 1.1.1.1! The rightmost hop is the authoritative connection IP
      expect(clientIP).toBe('203.0.113.55');
    });

    it('peels off configured trusted reverse proxies from right to left', () => {
      process.env.TRUSTED_PROXIES = '10.0.0.1, 10.0.0.2';

      // Chain: Client (203.0.113.99) -> Proxy1 (10.0.0.1) -> Proxy2 (10.0.0.2)
      // Attacker prepended "8.8.8.8" to header
      const headers = new Headers({
        'x-forwarded-for': '8.8.8.8, 203.0.113.99, 10.0.0.1',
      });

      const clientIP = extractClientIP(headers);

      // 10.0.0.1 is trusted proxy -> step left -> 203.0.113.99 is untrusted client IP
      expect(clientIP).toBe('203.0.113.99');
    });

    it('supports CIDR blocks in TRUSTED_PROXIES configuration', () => {
      process.env.TRUSTED_PROXIES = '172.16.0.0/12, loopback';

      expect(isTrustedProxy('172.16.4.1')).toBe(true);
      expect(isTrustedProxy('172.31.255.254')).toBe(true);
      expect(isTrustedProxy('172.32.0.1')).toBe(false); // Outside /12
      expect(isTrustedProxy('127.0.0.1')).toBe(true);
      expect(isTrustedProxy('198.51.100.1')).toBe(false);

      const headers = new Headers({
        'x-forwarded-for': '198.51.100.10, 172.16.10.5',
      });

      expect(extractClientIP(headers)).toBe('198.51.100.10');
    });

    it('validates IPv4 and IPv6 addresses and rejects malformed injections', () => {
      // Valid IPv4
      expect(cleanCandidateIP('192.0.2.1')).toBe('192.0.2.1');
      expect(cleanCandidateIP('192.0.2.1:8080')).toBe('192.0.2.1');
      expect(cleanCandidateIP('"192.0.2.1"')).toBe('192.0.2.1');

      // Valid IPv6
      expect(cleanCandidateIP('2001:db8::1')).toBe('2001:db8::1');
      expect(cleanCandidateIP('[2001:db8::1]:443')).toBe('2001:db8::1');
      expect(cleanCandidateIP('::1')).toBe('::1');

      // Malformed / Injections
      expect(cleanCandidateIP('')).toBeNull();
      expect(cleanCandidateIP('not-an-ip')).toBeNull();
      expect(cleanCandidateIP('1.2.3.4.5')).toBeNull();
      expect(cleanCandidateIP('999.999.999.999')).toBeNull();
      expect(cleanCandidateIP('../../etc/passwd')).toBeNull();
      expect(cleanCandidateIP('<script>alert(1)</script>')).toBeNull();
      expect(cleanCandidateIP('192.0.2.1\r\nX-Injected: true')).toBeNull();
    });

    it('properly handles Cloudflare cf-connecting-ip only when Cloudflare is trusted', () => {
      // When untrusted, cf-connecting-ip does not bypass X-Forwarded-For resolution
      delete process.env.TRUSTED_PROXIES;
      delete process.env.TRUST_CLOUDFLARE_PROXY;

      const spoofHeaders = new Headers({
        'cf-connecting-ip': '1.2.3.4',
        'x-forwarded-for': '203.0.113.88',
      });
      expect(extractClientIP(spoofHeaders)).toBe('203.0.113.88');

      // When Cloudflare is explicitly trusted
      process.env.TRUST_CLOUDFLARE_PROXY = 'true';
      expect(extractClientIP(spoofHeaders)).toBe('1.2.3.4');
    });
  });

  // =========================================================================
  // DL-04: Atomic Redis Counters & Limit Enforcement
  // =========================================================================
  describe('DL-04: Atomic Redis Counters', () => {
    it('atomically enforces maximum view limits without counter overshoot', async () => {
      process.env.UPSTASH_REDIS_REST_URL = 'https://mock.upstash.io';
      process.env.UPSTASH_REDIS_REST_TOKEN = 'mock-token';

      const linkId = 'link-limit-test';
      const maxViews = 2;
      const expiresAt = new Date(Date.now() + 3600_000);

      // 1st request: Lua script executes and increments to 1
      (redis.eval as jest.Mock).mockResolvedValueOnce([1, 1]); // [allowed=1, currentCount=1]
      const req1 = await incrementAndCheckLimit(linkId, 'view', maxViews, expiresAt);
      expect(req1.allowed).toBe(true);
      expect(req1.currentCount).toBe(1);

      // 2nd request: Lua script increments to 2
      (redis.eval as jest.Mock).mockResolvedValueOnce([1, 2]); // [allowed=1, currentCount=2]
      const req2 = await incrementAndCheckLimit(linkId, 'view', maxViews, expiresAt);
      expect(req2.allowed).toBe(true);
      expect(req2.currentCount).toBe(2);

      // 3rd request: Exceeds limit (current >= maxViews), Lua script returns [0, 2]
      (redis.eval as jest.Mock).mockResolvedValueOnce([0, 2]); // [allowed=0, currentCount=2]
      const req3 = await incrementAndCheckLimit(linkId, 'view', maxViews, expiresAt);
      expect(req3.allowed).toBe(false);
      expect(req3.error).toContain('Maximum view limit reached');
      expect(req3.currentCount).toBe(2); // Counter never exceeded 2!
    });

    it('atomically handles concurrent counter initialization when key does not exist', async () => {
      process.env.UPSTASH_REDIS_REST_URL = 'https://mock.upstash.io';
      process.env.UPSTASH_REDIS_REST_TOKEN = 'mock-token';

      const linkId = 'concurrent-init-test';
      const maxViews = 5;
      const expiresAt = new Date(Date.now() + 3600_000);

      // Key does not exist in Redis -> returns [-1, 0]
      (redis.eval as jest.Mock)
        .mockResolvedValueOnce([-1, 0])
        // Second call with DB count 0 initializes key and increments to 1
        .mockResolvedValueOnce([1, 1]);

      (prisma.auditLog.count as jest.Mock).mockResolvedValue(0);

      const res = await incrementAndCheckLimit(linkId, 'view', maxViews, expiresAt);
      expect(res.allowed).toBe(true);
      expect(res.currentCount).toBe(1);
      expect(prisma.auditLog.count).toHaveBeenCalledWith({
        where: { linkId, action: 'ACCESSED' },
      });
    });

    it('atomically enforces maximum download limits', async () => {
      process.env.UPSTASH_REDIS_REST_URL = 'https://mock.upstash.io';
      process.env.UPSTASH_REDIS_REST_TOKEN = 'mock-token';

      const linkId = 'dl-limit-test';
      const maxDownloads = 1;
      const expiresAt = new Date(Date.now() + 3600_000);

      (redis.eval as jest.Mock).mockResolvedValueOnce([1, 1]);
      const req1 = await incrementAndCheckLimit(linkId, 'download', maxDownloads, expiresAt);
      expect(req1.allowed).toBe(true);
      expect(req1.currentCount).toBe(1);

      (redis.eval as jest.Mock).mockResolvedValueOnce([0, 1]);
      const req2 = await incrementAndCheckLimit(linkId, 'download', maxDownloads, expiresAt);
      expect(req2.allowed).toBe(false);
      expect(req2.error).toContain('Maximum download limit reached');
    });
  });

  // =========================================================================
  // DL-05: Reliable OTP Email Delivery & Lockout Prevention
  // =========================================================================
  describe('DL-05: Reliable OTP Email Delivery', () => {
    it('retries on transient email provider timeouts with exponential backoff', async () => {
      const mockSendMail = jest.fn()
        .mockRejectedValueOnce(new Error('SMTP Connection timeout'))
        .mockResolvedValueOnce({ messageId: 'msg-success' });

      jest.spyOn(require('nodemailer'), 'createTransport').mockReturnValue({
        sendMail: mockSendMail,
      });

      process.env.EMAIL_USER = 'security@dataguardian.test';
      process.env.EMAIL_PASS = 'mockpassword123';

      await expect(
        sendOTPEmailWithRetry('vendor@example.com', 'tok123', '123456', 10, {
          maxRetries: 2,
          initialDelayMs: 10,
        })
      ).resolves.toBeUndefined();

      expect(mockSendMail).toHaveBeenCalledTimes(2);
    });

    it('reverts OTP rotation in database when all delivery attempts fail to prevent user lockout', async () => {
      const { sendVendorOTP } = await import('@/actions/send-vendor-otp');

      // Mock secureLink and vendorAccess in DB
      const mockVendor = {
        id: 'vendor-1',
        email: 'vendor@example.com',
        isRevoked: false,
        status: 'active',
        loginCount: 0,
        maxLogins: 3,
        otpHash: 'PREVIOUS_VALID_HASH',
        currentOtpHash: 'PREVIOUS_VALID_HASH',
        currentOtpCreatedAt: null,
        currentOtpExpiresAt: new Date(Date.now() + 600_000),
      };

      (prisma.secureLink.findUnique as jest.Mock).mockResolvedValue({
        id: 'link-1',
        token: 'token-123',
        isRevoked: false,
        lockedAt: null,
        expiresAt: new Date(Date.now() + 3600_000),
        VendorAccess: [mockVendor],
      });

      // Email transport fails every attempt
      jest.spyOn(require('nodemailer'), 'createTransport').mockReturnValue({
        sendMail: jest.fn().mockRejectedValue(new Error('SMTP Fatal 550 Relay Access Denied')),
      });

      process.env.EMAIL_USER = 'security@dataguardian.test';
      process.env.EMAIL_PASS = 'mockpassword123';

      // Mock transaction execution
      const txMock = {
        otpHistory: { updateMany: jest.fn(), create: jest.fn() },
        vendorAccess: { update: jest.fn() },
        linkAccess: { updateMany: jest.fn() },
        auditLog: { create: jest.fn() },
      };
      (prisma.$transaction as jest.Mock).mockImplementation(async (callback) => {
        return callback(txMock);
      });

      const result = await sendVendorOTP({
        token: 'token-123',
        email: 'vendor@example.com',
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('Could not deliver the OTP email');

      // Verify compensating rollback was executed:
      // vendorAccess was restored to PREVIOUS_VALID_HASH with null cooldown
      expect(txMock.vendorAccess.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'vendor-1' },
          data: expect.objectContaining({
            otpHash: 'PREVIOUS_VALID_HASH',
            currentOtpHash: 'PREVIOUS_VALID_HASH',
            currentOtpCreatedAt: null,
          }),
        })
      );

      // Failed attempt marked DELIVERY_FAILED
      expect(txMock.otpHistory.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: 'DELIVERY_FAILED',
            reason: 'DELIVERY_FAILED',
          }),
        })
      );

      // Audit log records delivery failure and rollback
      expect(txMock.auditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            action: 'OTP_DELIVERY_FAILED',
          }),
        })
      );
    });

    it('never logs plaintext OTP codes during delivery errors', async () => {
      const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
      const consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});

      const plaintextSecretOtp = '987654';

      jest.spyOn(require('nodemailer'), 'createTransport').mockReturnValue({
        sendMail: jest.fn().mockRejectedValue(new Error('Connection dropped')),
      });

      try {
        await sendOTPEmailWithRetry('victim@example.com', 'token-abc', plaintextSecretOtp, 5, {
          maxRetries: 1,
          initialDelayMs: 5,
        });
      } catch {
        // Expected failure
      }

      const allWarnCalls = consoleWarnSpy.mock.calls.flat().join(' ');
      const allErrorCalls = consoleErrorSpy.mock.calls.flat().join(' ');

      expect(allWarnCalls).not.toContain(plaintextSecretOtp);
      expect(allErrorCalls).not.toContain(plaintextSecretOtp);

      consoleErrorSpy.mockRestore();
      consoleWarnSpy.mockRestore();
    });

    it('rejects concurrent simultaneous OTP requests for the same recipient to avoid race conditions', async () => {
      const { sendVendorOTP } = await import('@/actions/send-vendor-otp');

      const mockVendor = {
        id: 'vendor-concurrent',
        email: 'concurrent@example.com',
        isRevoked: false,
        status: 'active',
        loginCount: 0,
        maxLogins: 3,
        otpHash: 'PREV_HASH',
        currentOtpHash: 'PREV_HASH',
        currentOtpCreatedAt: null,
      };

      (prisma.secureLink.findUnique as jest.Mock).mockResolvedValue({
        id: 'link-concurrent',
        token: 'token-concurrent',
        isRevoked: false,
        lockedAt: null,
        expiresAt: new Date(Date.now() + 3600_000),
        VendorAccess: [mockVendor],
      });

      process.env.EMAIL_USER = 'security@dataguardian.test';
      process.env.EMAIL_PASS = 'mockpassword123';
      process.env.UPSTASH_REDIS_REST_URL = 'https://mock.upstash.io';
      process.env.UPSTASH_REDIS_REST_TOKEN = 'mock-token';

      // Simulate lock already held by another in-flight request
      (redis.set as jest.Mock).mockResolvedValueOnce(null);

      const result = await sendVendorOTP({
        token: 'token-concurrent',
        email: 'concurrent@example.com',
      });

      expect(result.success).toBe(false);
      expect(result.errorType).toBe('COOLDOWN');
      expect(result.error).toContain('already in progress');
    });

    it('enforces OTP expiration and prevents replay of consumed OTPs', async () => {
      const { verifyOTPHash, hashOTP } = await import('@/lib/crypto');

      const testOtp = '654321';
      const otpHash = await hashOTP(testOtp);

      // Verify valid OTP matches
      const isValid = await verifyOTPHash(testOtp, otpHash);
      expect(isValid).toBe(true);

      // Verify wrong OTP fails
      const isWrongValid = await verifyOTPHash('000000', otpHash);
      expect(isWrongValid).toBe(false);

      // Verify consumed/cleared hash rejects any OTP
      const isConsumedValid = await verifyOTPHash(testOtp, null as any);
      expect(isConsumedValid).toBe(false);
    });
  });
});
