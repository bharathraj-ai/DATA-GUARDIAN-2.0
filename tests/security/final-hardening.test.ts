import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { generateCspNonce, buildCspHeader } from '@/lib/security/csp';
import { logger, sanitizeLogString, redactSensitiveData } from '@/lib/logger';
import { detectOrphanFiles, cleanOrphanFiles } from '@/lib/storage/orphan-cleanup';
import { prisma } from '@/lib/prisma';

// Mock prisma for controlled orphan testing
jest.mock('@/lib/prisma', () => ({
  prisma: {
    $queryRawUnsafe: jest.fn(),
    document: {
      findMany: jest.fn(),
      count: jest.fn(),
    },
    auditLog: {
      create: jest.fn(),
    },
  },
}));

describe('Final Hardening Phase — SV-07, SV-08, Reliability', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // =========================================================================
  // SV-07: CONTENT SECURITY POLICY TESTS
  // =========================================================================
  describe('SV-07: Content Security Policy & Nonce Enforcement', () => {
    it('generates cryptographically strong, unique nonces', () => {
      const nonces = new Set<string>();
      for (let i = 0; i < 50; i++) {
        const nonce = generateCspNonce();
        expect(nonce).toBeDefined();
        // 16 bytes base64 encoded is 22 or 24 chars
        expect(nonce.length).toBeGreaterThanOrEqual(22);
        nonces.add(nonce);
      }
      expect(nonces.size).toBe(50); // All unique
    });

    it('enforces nonce and strict-dynamic in production script-src without unsafe-inline', () => {
      const nonce = 'test-crypto-nonce-12345';
      const csp = buildCspHeader(nonce, { isDev: false });

      // Verify script-src has nonce and strict-dynamic
      expect(csp).toContain(`script-src 'self' 'nonce-${nonce}' 'strict-dynamic'`);

      // Critical: unsafe-inline MUST NOT be present in production script-src
      const scriptSrcPart = csp.split(';').find((part) => part.trim().startsWith('script-src'));
      expect(scriptSrcPart).toBeDefined();
      expect(scriptSrcPart).not.toContain("'unsafe-inline'");
      expect(scriptSrcPart).not.toContain("'unsafe-eval'");
    });

    it('allows unsafe-eval ONLY in development mode for React/Next.js HMR', () => {
      const nonce = 'dev-nonce';
      const devCsp = buildCspHeader(nonce, { isDev: true });
      const prodCsp = buildCspHeader(nonce, { isDev: false });

      expect(devCsp).toContain("'unsafe-eval'");
      expect(prodCsp).not.toContain("'unsafe-eval'");
    });

    it('prevents inline script injection attacks via missing nonce', () => {
      const nonce = 'valid-session-nonce-xyz';
      const csp = buildCspHeader(nonce, { isDev: false });

      // Attacker payload without nonce
      const maliciousInlineScript = '<script>evilPayload()</script>';
      const isNonceAttached = maliciousInlineScript.includes(`nonce="${nonce}"`);
      expect(isNonceAttached).toBe(false);

      // Verify that CSP mandates the specific nonce
      expect(csp).toContain(`'nonce-${nonce}'`);
      expect(csp).toContain("'strict-dynamic'");
    });

    it('preserves legitimate application external integrations and auth providers', () => {
      const nonce = 'auth-test-nonce';
      const csp = buildCspHeader(nonce, { isDev: false });

      // Google OAuth and auth redirects
      expect(csp).toContain('form-action \'self\' https://accounts.google.com');
      expect(csp).toContain('frame-src \'self\' blob: data: https://accounts.google.com');
      expect(csp).toContain('connect-src \'self\' https://*.upstash.io https://*.neon.tech https://accounts.google.com');

      // Trusted avatars
      expect(csp).toContain('https://lh3.googleusercontent.com');
      expect(csp).toContain('https://avatars.githubusercontent.com');

      // Google Fonts
      expect(csp).toContain('https://fonts.googleapis.com');
      expect(csp).toContain('https://fonts.gstatic.com');

      // Clickjacking and base-uri protections
      expect(csp).toContain("frame-ancestors 'none'");
      expect(csp).toContain("base-uri 'self'");
      expect(csp).toContain("object-src 'none'");
    });

    it('configures ONLYOFFICE integration when requesting editor routes', () => {
      const nonce = 'editor-nonce';
      const editorCsp = buildCspHeader(nonce, {
        isDev: false,
        pathname: '/editor/token123/file456',
        onlyOfficeServerUrl: 'https://office.dataguardian.example',
      });

      expect(editorCsp).toContain('https://office.dataguardian.example');
      const parts = editorCsp.split(';');
      const scriptSrc = parts.find((p) => p.trim().startsWith('script-src'));
      const frameSrc = parts.find((p) => p.trim().startsWith('frame-src'));
      expect(scriptSrc).toContain('https://office.dataguardian.example');
      expect(frameSrc).toContain('https://office.dataguardian.example');
    });
  });

  // =========================================================================
  // SV-08: SECURE LOGGING & REDACTION TESTS
  // =========================================================================
  describe('SV-08: Centralized Redacting Logger', () => {
    it('redacts plaintext passwords, OTPs, passcodes, and security codes in objects', () => {
      const payload = {
        user: 'alice',
        password: 'SuperSecretPassword123!',
        currentOtp: '984512',
        otpCode: '123456',
        passcode: '887766',
        authCode: '112233',
        safeMetadata: 'public-info',
      };

      const redacted = redactSensitiveData(payload) as Record<string, unknown>;

      expect(redacted.user).toBe('alice');
      expect(redacted.safeMetadata).toBe('public-info');
      expect(redacted.password).toBe('[REDACTED_PASSWORD]');
      expect(redacted.currentOtp).toBe('[REDACTED_OTP]');
      expect(redacted.otpCode).toBe('[REDACTED_OTP]');
      expect(redacted.passcode).toBe('[REDACTED_OTP]');
      expect(redacted.authCode).toBe('[REDACTED_OTP]');
    });

    it('redacts encryption keys, DEKs, and HMAC secrets', () => {
      const payload = {
        encryptionKey: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
        dek: 'secret-document-key',
        rawKey: 'master-key-bytes',
        nonSensitiveId: 'doc-999',
      };

      const redacted = redactSensitiveData(payload) as Record<string, unknown>;

      expect(redacted.nonSensitiveId).toBe('doc-999');
      expect(redacted.encryptionKey).toBe('[REDACTED_KEY]');
      expect(redacted.dek).toBe('[REDACTED_KEY]');
      expect(redacted.rawKey).toBe('[REDACTED_KEY]');
    });

    it('redacts binary buffers and file contents from log payloads', () => {
      const filePayload = {
        fileName: 'confidential_contract.docx',
        buffer: Buffer.from('Sensitive proprietary contract contents!'),
        fileContent: 'raw binary content',
        nested: {
          encryptedContent: 'encrypted-base64-blob',
        },
      };

      const redacted = redactSensitiveData(filePayload) as any;

      expect(redacted.fileName).toBe('confidential_contract.docx');
      expect(redacted.buffer).toBe('[REDACTED_CONTENT]');
      expect(redacted.fileContent).toBe('[REDACTED_CONTENT]');
      expect(redacted.nested.encryptedContent).toBe('[REDACTED_CONTENT]');
    });

    it('sanitizes database connection strings and bearer tokens in strings and exceptions', () => {
      const rawError = new Error(
        'Connection failed: postgres://postgres:P@ssword123@neon.tech:5432/dataguardian?sslmode=require'
      );
      (rawError as any).code = 'ECONNREFUSED';

      const sanitizedErr = redactSensitiveData(rawError) as any;

      expect(sanitizedErr.name).toBe('Error');
      expect(sanitizedErr.message).not.toContain('P@ssword123');
      expect(sanitizedErr.message).toContain('postgres://postgres:[REDACTED_PASSWORD]@neon.tech:5432/dataguardian?sslmode=require');
      expect(sanitizedErr.code).toBe('ECONNREFUSED');
    });

    it('sanitizes session cookies and bearer tokens from raw strings', () => {
      const logLine = 'Request headers: Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5...; Cookie: session_id=session_token_xyz999;';
      const sanitized = sanitizeLogString(logLine);

      expect(sanitized).not.toContain('eyJhbGciOiJIUzI1NiIsInR5...');
      expect(sanitized).not.toContain('session_token_xyz999');
      expect(sanitized).toContain('Bearer [REDACTED_TOKEN]');
      expect(sanitized).toContain('session_id=[REDACTED_SESSION]');
    });

    it('sanitizes active environment secrets if they leak into error messages', () => {
      const testSecret = 'mock-super-secret-key-32-chars-long';
      const prevSecret = process.env.ENCRYPTION_KEY;
      process.env.ENCRYPTION_KEY = testSecret;

      try {
        const leakedMsg = `Failed with key: ${testSecret} during AES operation`;
        const sanitized = sanitizeLogString(leakedMsg);
        expect(sanitized).not.toContain(testSecret);
        expect(sanitized).toContain('[REDACTED_SECRET]');
      } finally {
        process.env.ENCRYPTION_KEY = prevSecret;
      }
    });

    it('logs structured security events without exposing sensitive details', () => {
      const consoleSpy = jest.spyOn(console, 'warn').mockImplementation();
      try {
        logger.securityEvent('UNAUTHORIZED_ACCESS_ATTEMPT', {
          token: 'token-abc-12345678',
          email: 'victim@example.com',
          password: 'attempted-password',
        });

        expect(consoleSpy).toHaveBeenCalledTimes(1);
        const loggedJson = consoleSpy.mock.calls[0][0];
        expect(loggedJson).toContain('SECURITY');
        expect(loggedJson).toContain('UNAUTHORIZED_ACCESS_ATTEMPT');
        expect(loggedJson).not.toContain('attempted-password');
        expect(loggedJson).toContain('[REDACTED_PASSWORD]');
        expect(loggedJson).toContain('v***@example.com'); // redacted email
      } finally {
        consoleSpy.mockRestore();
      }
    });
  });

  // =========================================================================
  // RELIABILITY HARDENING: ORPHAN-FILE DETECTION & SAFE CLEANUP TESTS
  // =========================================================================
  describe('Reliability Hardening: Automated Orphan-File Detection & Safe Cleanup', () => {
    let testStorageDir: string;

    beforeEach(async () => {
      testStorageDir = await fs.mkdtemp(path.join(os.tmpdir(), 'dg-test-storage-'));
      await fs.mkdir(path.join(testStorageDir, 'documents'), { recursive: true });
      await fs.mkdir(path.join(testStorageDir, 'versions'), { recursive: true });
    });

    afterEach(async () => {
      try {
        await fs.rm(testStorageDir, { recursive: true, force: true });
      } catch {}
    });

    it('fails closed when database is unreachable — never deletes files on DB failure', async () => {
      // Simulate database failure
      (prisma.$queryRawUnsafe as jest.Mock).mockRejectedValueOnce(new Error('Connection terminated unexpectedly'));

      const result = await detectOrphanFiles({
        storageRoot: testStorageDir,
        gracePeriodMinutes: 0,
      });

      expect(result.success).toBe(false);
      expect(result.orphans).toEqual([]);
      expect(result.error).toContain('Database connection check failed');
    });

    it('preserves recent files within the grace period (active in-flight uploads)', async () => {
      (prisma.$queryRawUnsafe as jest.Mock).mockResolvedValueOnce([{ '?column?': 1 }]);
      (prisma.document.findMany as jest.Mock).mockResolvedValueOnce([]);

      // Create a directory created RIGHT NOW (within grace period)
      const recentDocId = 'recent-doc-uuid-1';
      const recentDir = path.join(testStorageDir, 'documents', recentDocId);
      await fs.mkdir(recentDir, { recursive: true });
      await fs.writeFile(path.join(recentDir, 'active_upload.pdf'), 'uploading...');

      // Run detection with 30-minute grace period
      const result = await detectOrphanFiles({
        storageRoot: testStorageDir,
        gracePeriodMinutes: 30,
      });

      expect(result.success).toBe(true);
      expect(result.orphans.length).toBe(0);
      expect(result.skippedRecentCount).toBeGreaterThanOrEqual(1);

      // Verify directory was NOT marked as orphan and file remains intact
      const exists = await fs.access(recentDir).then(() => true).catch(() => false);
      expect(exists).toBe(true);
    });

    it('detects orphaned files older than grace period without matching DB records', async () => {
      (prisma.$queryRawUnsafe as jest.Mock).mockResolvedValueOnce([{ '?column?': 1 }]);

      const activeDocId = 'doc-active-123';
      const orphanDocId = 'doc-orphan-456';
      const deletedDocId = 'doc-soft-deleted-789';

      // 1. Active document directory
      const activeDir = path.join(testStorageDir, 'documents', activeDocId);
      await fs.mkdir(activeDir, { recursive: true });
      await fs.writeFile(path.join(activeDir, 'file.pdf'), 'data');

      // 2. Orphan document directory (no record in DB)
      const orphanDir = path.join(testStorageDir, 'documents', orphanDocId);
      await fs.mkdir(orphanDir, { recursive: true });
      await fs.writeFile(path.join(orphanDir, 'abandoned.pdf'), 'orphan data');

      // 3. Soft-deleted document directory (isDeleted: true in DB)
      const deletedDir = path.join(testStorageDir, 'documents', deletedDocId);
      await fs.mkdir(deletedDir, { recursive: true });
      await fs.writeFile(path.join(deletedDir, 'deleted.pdf'), 'deleted data');

      // 4. Abandoned .upload_*.tmp file at root documents level
      const tmpFile = path.join(testStorageDir, 'documents', '.upload_12345_abc.tmp');
      await fs.writeFile(tmpFile, 'temp bytes');

      // Set mtimes older than grace period (e.g. 2 hours ago)
      const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
      await fs.utimes(orphanDir, twoHoursAgo, twoHoursAgo);
      await fs.utimes(deletedDir, twoHoursAgo, twoHoursAgo);
      await fs.utimes(tmpFile, twoHoursAgo, twoHoursAgo);

      // DB mock returns only active doc and soft-deleted doc
      (prisma.document.findMany as jest.Mock).mockResolvedValueOnce([
        { id: activeDocId, isDeleted: false },
        { id: deletedDocId, isDeleted: true },
      ]);

      const result = await detectOrphanFiles({
        storageRoot: testStorageDir,
        gracePeriodMinutes: 30,
      });

      expect(result.success).toBe(true);
      const orphanPaths = result.orphans.map((o) => o.path);

      // Orphan doc directory should be detected (no_matching_record)
      expect(orphanPaths).toContain(orphanDir);
      // Soft-deleted doc directory should be detected (marked_deleted)
      expect(orphanPaths).toContain(deletedDir);
      // Abandoned tmp file should be detected
      expect(orphanPaths).toContain(tmpFile);
      // Active doc directory MUST NOT be detected!
      expect(orphanPaths).not.toContain(activeDir);
    });

    it('cleanOrphanFiles safely deletes orphans, records audit logs, and is idempotent', async () => {
      // Setup DB mocks for detection
      (prisma.$queryRawUnsafe as jest.Mock).mockResolvedValue([{ '?column?': 1 }]);
      (prisma.document.findMany as jest.Mock)
        .mockResolvedValueOnce([]) // First detection: docId is orphan
        .mockResolvedValueOnce([]); // Second detection: no entries

      (prisma.auditLog.create as jest.Mock).mockResolvedValue({ id: 'audit-1' });

      // Create an orphan directory with past timestamp
      const orphanDocId = 'orphan-to-delete-999';
      const orphanDir = path.join(testStorageDir, 'documents', orphanDocId);
      await fs.mkdir(orphanDir, { recursive: true });
      await fs.writeFile(path.join(orphanDir, 'old_file.pdf'), 'abandoned content');

      const past = new Date(Date.now() - 3600 * 1000);
      await fs.utimes(orphanDir, past, past);

      // First run: deletes orphan
      const result1 = await cleanOrphanFiles({
        storageRoot: testStorageDir,
        gracePeriodMinutes: 10,
      });

      expect(result1.success).toBe(true);
      expect(result1.deletedCount).toBe(1);
      expect(result1.deletedPaths).toContain(orphanDir);

      // Verify physical directory was removed
      const existsAfter = await fs.access(orphanDir).then(() => true).catch(() => false);
      expect(existsAfter).toBe(false);

      // Verify audit log was created
      expect(prisma.auditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            action: 'ORPHAN_FILE_CLEANUP',
          }),
        })
      );

      // Second run (Idempotence test): repeated execution should succeed with 0 deletions
      const result2 = await cleanOrphanFiles({
        storageRoot: testStorageDir,
        gracePeriodMinutes: 10,
      });

      expect(result2.success).toBe(true);
      expect(result2.deletedCount).toBe(0);
      expect(result2.deletedPaths).toEqual([]);
    });

    it('survives concurrent deletions without throwing', async () => {
      (prisma.$queryRawUnsafe as jest.Mock).mockResolvedValue([{ '?column?': 1 }]);
      (prisma.document.findMany as jest.Mock).mockResolvedValue([]);
      (prisma.auditLog.create as jest.Mock).mockResolvedValue({ id: 'audit-2' });

      // Create two orphan directories
      const dir1 = path.join(testStorageDir, 'documents', 'concurrent-orphan-1');
      const dir2 = path.join(testStorageDir, 'documents', 'concurrent-orphan-2');
      await fs.mkdir(dir1, { recursive: true });
      await fs.mkdir(dir2, { recursive: true });

      const past = new Date(Date.now() - 3600 * 1000);
      await fs.utimes(dir1, past, past);
      await fs.utimes(dir2, past, past);

      // Simulate concurrent removal of dir1 by another process right before cleanOrphanFiles tries
      await fs.rm(dir1, { recursive: true, force: true });

      // Should delete dir2 and handle missing dir1 gracefully without throwing
      const result = await cleanOrphanFiles({
        storageRoot: testStorageDir,
        gracePeriodMinutes: 10,
      });

      expect(result.success).toBe(true);
      expect(result.deletedPaths).toContain(dir2);
    });
  });
});
