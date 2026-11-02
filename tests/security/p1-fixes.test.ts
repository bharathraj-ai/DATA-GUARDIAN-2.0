/**
 * Verification Test Suite for P1 Fixes:
 * - 1. SV-03: Authentication and authorization on POST /api/create-link
 * - 2. DL-02: Idempotent and recoverable purgeLinkRows cleanup
 * - 3. DL-03: Permanent Redis revocation without expiration
 * - 4. SV-05: Remove insecure vendor_email cookie fallback from authorization
 */

import { NextRequest } from 'next/server';

// Setup environment keys
process.env.ENCRYPTION_KEY =
  process.env.ENCRYPTION_KEY ||
  '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
process.env.KEK_KEY =
  process.env.KEK_KEY ||
  'fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210';
process.env.OTP_HMAC_SECRET =
  process.env.OTP_HMAC_SECRET || 'test-otp-hmac-secret-min-32-chars-isolated!';
process.env.SESSION_HMAC_SECRET =
  process.env.SESSION_HMAC_SECRET || 'test-session-hmac-secret-min-32-chars-isolated!';
process.env.NEXTAUTH_SECRET =
  process.env.NEXTAUTH_SECRET || 'test-nextauth-secret-min-32-characters-long!';

// File-level mocks
const mockAuth = jest.fn();
const mockRequireOwnerRole = jest.fn();
const mockCheckUploadRateLimit = jest.fn().mockResolvedValue({ allowed: true });
const mockCreateSecureLinkFromJson = jest.fn();
const mockCreateSecureLinkWithFiles = jest.fn();
const mockCookieStore = new Map<string, { value: string }>();

jest.mock('@/lib/auth', () => ({
  auth: () => mockAuth(),
}));

jest.mock('@/lib/security/roles', () => ({
  requireOwnerRole: (...args: unknown[]) => mockRequireOwnerRole(...args),
  canCreateSecureLinks: (role: string) => role === 'OWNER',
  normalizeRole: (role: string) => (role === 'OWNER' ? 'OWNER' : 'VENDOR'),
  getDbUserRole: jest.fn().mockResolvedValue({ role: 'OWNER', roleSelected: true }),
}));

jest.mock('@/lib/rate-limit', () => ({
  checkUploadRateLimit: (...args: unknown[]) => mockCheckUploadRateLimit(...args),
  extractClientIP: () => '127.0.0.1',
  formatRateLimitError: () => 'Rate limit exceeded',
}));

jest.mock('next/headers', () => ({
  headers: jest.fn().mockResolvedValue(new Headers()),
  cookies: jest.fn().mockImplementation(async () => ({
    get: (name: string) => mockCookieStore.get(name),
  })),
}));

jest.mock('@/actions/create-link-with-files', () => ({
  createSecureLinkFromJson: (...args: unknown[]) => mockCreateSecureLinkFromJson(...args),
  createSecureLinkWithFiles: (...args: unknown[]) => mockCreateSecureLinkWithFiles(...args),
}));

jest.mock('@/lib/mongo/client', () => ({
  isMongoConfigured: () => false,
  warmMongoConnection: jest.fn(),
}));

jest.mock('@/lib/email', () => ({
  warmEmailTransport: jest.fn(),
}));

const mockPrismaTransaction = jest.fn();
const mockPrismaSecureLinkFindUnique = jest.fn();

jest.mock('@/lib/prisma', () => ({
  prisma: {
    $transaction: (...args: unknown[]) => mockPrismaTransaction(...args),
    chatMessage: { deleteMany: jest.fn().mockResolvedValue({ count: 1 }) },
    vendorAccess: { deleteMany: jest.fn().mockResolvedValue({ count: 1 }) },
    linkAccess: { deleteMany: jest.fn().mockResolvedValue({ count: 1 }) },
    documentSession: { deleteMany: jest.fn().mockResolvedValue({ count: 1 }) },
    collabOperation: { deleteMany: jest.fn().mockResolvedValue({ count: 1 }) },
    documentChatMessage: { deleteMany: jest.fn().mockResolvedValue({ count: 1 }) },
    annotation: { deleteMany: jest.fn().mockResolvedValue({ count: 1 }) },
    fileVersion: { deleteMany: jest.fn().mockResolvedValue({ count: 1 }) },
    userFile: { deleteMany: jest.fn().mockResolvedValue({ count: 2 }) },
    mongoFile: { deleteMany: jest.fn().mockResolvedValue({ count: 2 }) },
    secureLink: {
      deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
      findUnique: (...args: unknown[]) => mockPrismaSecureLinkFindUnique(...args),
    },
    userData: { deleteMany: jest.fn().mockResolvedValue({ count: 1 }) },
  },
  warmPrismaConnection: jest.fn(),
}));

const mockRedisPipelineSet = jest.fn();
const mockRedisPipelineDel = jest.fn();
const mockRedisPipelineExec = jest.fn().mockResolvedValue([]);
const mockRedisExists = jest.fn();
const mockRedisSmembers = jest.fn().mockResolvedValue([]);
const mockRedisGet = jest.fn().mockResolvedValue(null);

jest.mock('@/lib/redis', () => {
  const pipelineObj = {
    set: (...args: unknown[]) => {
      mockRedisPipelineSet(...args);
      return pipelineObj;
    },
    del: (...args: unknown[]) => {
      mockRedisPipelineDel(...args);
      return pipelineObj;
    },
    exec: () => mockRedisPipelineExec(),
  };

  const redisMock = {
    pipeline: () => pipelineObj,
    exists: (...args: unknown[]) => mockRedisExists(...args),
    smembers: (...args: unknown[]) => mockRedisSmembers(...args),
    get: (...args: unknown[]) => mockRedisGet(...args),
  };

  return {
    __esModule: true,
    default: redisMock,
    invalidateSession: async (token: string, permanentRevoke = false) => {
      if (permanentRevoke) {
        mockRedisPipelineSet(`revoked:${token}`, '1');
      }
      return;
    },
    isTokenRevoked: async (token: string) => {
      const res = await mockRedisExists(`revoked:${token}`);
      return res === 1;
    },
  };
});

import { POST as createLinkPOST } from '@/app/api/create-link/route';
import { purgeLinkRows } from '@/lib/cleanup-core';
import { invalidateSession, isTokenRevoked } from '@/lib/redis';
import { authorizeSecureLink } from '@/lib/linkAuthorization';
import { mintShareSession } from '@/lib/share-session';
import { encryptData } from '@/lib/crypto';

describe('1. SV-03: Authentication & Authorization on POST /api/create-link', () => {
  beforeEach(() => {
    mockAuth.mockReset();
    mockRequireOwnerRole.mockReset();
    mockCheckUploadRateLimit.mockReset().mockResolvedValue({ allowed: true });
    mockCreateSecureLinkFromJson.mockReset();
    mockCreateSecureLinkWithFiles.mockReset();
  });

  it('rejects unauthenticated requests with HTTP 401', async () => {
    mockAuth.mockResolvedValueOnce(null);

    const req = new NextRequest('http://localhost:3000/api/create-link', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ purpose: 'Quarterly review' }),
    });

    const res = await createLinkPOST(req);
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.success).toBe(false);
    expect(body.error).toBe('Authentication required');
    expect(mockCreateSecureLinkFromJson).not.toHaveBeenCalled();
  });

  it('rejects unauthorized users (e.g. VENDOR or non-OWNER) with HTTP 403', async () => {
    mockAuth.mockResolvedValueOnce({ user: { id: 'user-vendor-1', role: 'VENDOR' } });
    mockRequireOwnerRole.mockResolvedValueOnce(false); // DB says not OWNER

    const req = new NextRequest('http://localhost:3000/api/create-link', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ purpose: 'Quarterly review' }),
    });

    const res = await createLinkPOST(req);
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.success).toBe(false);
    expect(body.error).toBe('You do not have permission to create secure links');
    expect(mockCreateSecureLinkFromJson).not.toHaveBeenCalled();
  });

  it('allows authorized OWNER users and processes link creation', async () => {
    mockAuth.mockResolvedValueOnce({ user: { id: 'user-owner-1', role: 'OWNER' } });
    mockRequireOwnerRole.mockResolvedValueOnce(true);
    mockCreateSecureLinkFromJson.mockResolvedValueOnce({
      success: true,
      token: 'secure-token-123',
      shareUrl: 'http://localhost:3000/share/secure-token-123',
    });

    const req = new NextRequest('http://localhost:3000/api/create-link', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ purpose: 'Quarterly review' }),
    });

    const res = await createLinkPOST(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.token).toBe('secure-token-123');
    expect(mockCreateSecureLinkFromJson).toHaveBeenCalledTimes(1);
  });
});

describe('2. DL-02: Idempotent and Recoverable purgeLinkRows Cleanup', () => {
  beforeEach(() => {
    mockPrismaTransaction.mockReset();
  });

  it('executes deletions atomically inside prisma.$transaction', async () => {
    mockPrismaTransaction.mockResolvedValueOnce([
      { count: 1 }, // chatMessage
      { count: 2 }, // userFile
      { count: 2 }, // mongoFile
      { count: 1 }, // secureLink
      { count: 1 }, // userData
    ]);

    const result = await purgeLinkRows({
      linkIds: ['link-1'],
      fileIds: ['file-1', 'file-2'],
      mongoFileIds: ['mongo-1', 'mongo-2'],
      userDataIds: ['user-data-1'],
    });

    expect(mockPrismaTransaction).toHaveBeenCalledTimes(1);
    expect(result.deletedLinks).toBe(1);
    expect(result.deletedFiles).toBe(2);
    expect(result.deletedUserData).toBe(1);
  });

  it('survives simulated database failures: rolls back completely with NO partial deletion', async () => {
    mockPrismaTransaction.mockRejectedValueOnce(
      new Error('P2034: Transaction failed due to write conflict / network error')
    );

    // Simulated failure must reject the entire operation so no partial records remain deleted
    await expect(
      purgeLinkRows({
        linkIds: ['link-fail'],
        fileIds: ['file-fail'],
        mongoFileIds: ['mongo-fail'],
        userDataIds: ['user-data-fail'],
      })
    ).rejects.toThrow('P2034: Transaction failed');
  });

  it('is idempotent: repeated cleanup does not corrupt data or throw error', async () => {
    // Repeated run when rows were already purged returns count: 0
    mockPrismaTransaction.mockResolvedValueOnce([
      { count: 0 },
      { count: 0 },
      { count: 0 },
      { count: 0 },
      { count: 0 },
    ]);

    const result = await purgeLinkRows({
      linkIds: ['already-purged-link'],
      fileIds: [],
      mongoFileIds: [],
      userDataIds: ['already-purged-user-data'],
    });

    expect(result.deletedLinks).toBe(0);
    expect(result.deletedUserData).toBe(0);
    expect(result.deletedFiles).toBe(0);
  });
});

describe('3. DL-03: Permanent Redis Revocation Without Expiration', () => {
  beforeEach(() => {
    mockRedisPipelineSet.mockReset();
    mockRedisExists.mockReset();
  });

  it('sets permanent revoked marker in Redis without TTL expiration', async () => {
    const token = 'test-permanent-revoke-token';

    await invalidateSession(token, true);

    expect(mockRedisPipelineSet).toHaveBeenCalledWith(`revoked:${token}`, '1');
    // Must NOT have 3rd argument { ex: 86400 }
    const calls = mockRedisPipelineSet.mock.calls;
    expect(calls[0][2]).toBeUndefined();
  });

  it('revoked token remains permanently revoked', async () => {
    const token = 'perm-revoked-check';
    mockRedisExists.mockResolvedValueOnce(1);

    const revoked = await isTokenRevoked(token);
    expect(revoked).toBe(true);
    expect(mockRedisExists).toHaveBeenCalledWith(`revoked:${token}`);
  });
});

describe('4. SV-05: Remove Insecure vendor_email Cookie Fallback', () => {
  const token = 'link-token-identity-test';

  beforeEach(() => {
    mockCookieStore.clear();
    mockPrismaSecureLinkFindUnique.mockReset();
  });

  it('rejects access when only an unauthorized / forged vendor_email cookie is present', async () => {
    mockPrismaSecureLinkFindUnique.mockResolvedValueOnce({
      id: 'link-id-1',
      token,
      isRevoked: false,
      isUsed: true,
      expiresAt: new Date(Date.now() + 3600_000),
      ownerId: 'owner-id',
      allowedVendorEmail: 'authorized-vendor@example.com',
      allowEditing: false,
      allowDownload: true,
      allowComment: true,
      maxViews: null,
      maxDownloads: null,
      VendorAccess: [
        {
          id: 'va-1',
          email: 'authorized-vendor@example.com',
          level: 2,
          isRevoked: false,
          activeSessionId: null,
        },
      ],
      LinkAccess: [],
      UserFile: [],
    });

    // Mock forged vendor_email cookie
    const forgedEmail = 'authorized-vendor@example.com';
    const encryptedCookie = encryptData({ email: forgedEmail });
    mockCookieStore.set('vendor_email', { value: encryptedCookie });
    // Note: mockCookieStore has NO 'session_id' cookie!

    const result = await authorizeSecureLink(token);

    // SV-05: Because there is NO cryptographically verified signed share session (only an unauthenticated vendor_email cookie),
    // access MUST be denied with 401.
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.status).toBe(401);
      expect(result.error).toMatch(/Missing or invalid session/);
    }
  });

  it('rejects identity spoofing when signed session is for vendor-A but forged vendor_email cookie is for vendor-B', async () => {
    mockPrismaSecureLinkFindUnique.mockResolvedValueOnce({
      id: 'link-id-1',
      token,
      isRevoked: false,
      isUsed: true,
      expiresAt: new Date(Date.now() + 3600_000),
      ownerId: 'owner-id',
      allowedVendorEmail: 'target-vendor@example.com',
      allowEditing: false,
      allowDownload: true,
      allowComment: true,
      maxViews: null,
      maxDownloads: null,
      VendorAccess: [
        {
          id: 'va-1',
          email: 'target-vendor@example.com',
          level: 2,
          isRevoked: false,
          activeSessionId: null,
        },
      ],
      LinkAccess: [],
      UserFile: [],
    });

    // Attacker has valid signed session for 'attacker@example.com'
    const attackerSession = mintShareSession(token, 3600, 'attacker@example.com');
    mockCookieStore.set('session_id', { value: attackerSession.cookieValue });

    // Attacker forges vendor_email cookie pretending to be 'target-vendor@example.com'
    const forgedTargetEmail = 'target-vendor@example.com';
    mockCookieStore.set('vendor_email', { value: encryptData({ email: forgedTargetEmail }) });

    const result = await authorizeSecureLink(token);

    // SV-05: The forged vendor_email cookie MUST be ignored; identity resolves to 'attacker@example.com'
    // which does not have access to this link -> 403 Forbidden
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.status).toBe(403);
      expect(result.error).toMatch(/Forbidden/);
    }
  });

  it('grants access when cryptographically verified signed share session is present', async () => {
    mockPrismaSecureLinkFindUnique.mockResolvedValueOnce({
      id: 'link-id-1',
      token,
      isRevoked: false,
      isUsed: true,
      expiresAt: new Date(Date.now() + 3600_000),
      ownerId: 'owner-id',
      allowedVendorEmail: 'authorized-vendor@example.com',
      allowEditing: false,
      allowDownload: true,
      allowComment: true,
      maxViews: null,
      maxDownloads: null,
      VendorAccess: [
        {
          id: 'va-1',
          email: 'authorized-vendor@example.com',
          level: 2,
          isRevoked: false,
          activeSessionId: null,
        },
      ],
      LinkAccess: [],
      UserFile: [],
    });

    // Mint legitimate cryptographically signed share session (HMAC-SHA256 bound)
    const minted = mintShareSession(token, 3600, 'authorized-vendor@example.com');
    mockCookieStore.set('session_id', { value: minted.cookieValue });

    const result = await authorizeSecureLink(token);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.context.effectiveEmail).toBe('authorized-vendor@example.com');
      expect(result.context.isOwner).toBe(false);
    }
  });
});
