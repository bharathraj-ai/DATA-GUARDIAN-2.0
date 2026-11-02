/**
 * Verification Test Suite for P0 Fixes:
 * - FIX 1: Cryptographic Key Separation (SV-02)
 * - FIX 2: Upload Data Consistency (DL-01)
 * - FIX 3: Filename Security (SV-01)
 */

import crypto from 'crypto';
import fs from 'fs/promises';
import path from 'path';

// Set up isolated, valid cryptographic secrets for test baseline
const TEST_ENCRYPTION_KEY = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
const TEST_KEK_KEY = 'fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210';
const TEST_OTP_SECRET = 'test-otp-hmac-secret-min-32-chars-strictly-isolated!';
const TEST_SESSION_SECRET = 'test-session-hmac-secret-min-32-chars-isolated-too!';
const TEST_NEXTAUTH_SECRET = 'test-nextauth-secret-min-32-characters-long!';

process.env.ENCRYPTION_KEY = TEST_ENCRYPTION_KEY;
process.env.KEK_KEY = TEST_KEK_KEY;
process.env.OTP_HMAC_SECRET = TEST_OTP_SECRET;
process.env.SESSION_HMAC_SECRET = TEST_SESSION_SECRET;
process.env.NEXTAUTH_SECRET = TEST_NEXTAUTH_SECRET;

import {
  generateOTP,
  hashOTPSync,
  hashOTP,
  verifyOTPHash,
  encryptData,
  decryptData,
  generateDek,
  encryptDek,
  decryptDek,
  encryptBuffer,
  decryptBuffer,
  getOtpHmacSecret,
  getEncryptionKey,
  getKekKey,
} from '@/lib/crypto';
import {
  mintShareSession,
  verifyShareSession,
  getSessionSecret,
} from '@/lib/share-session';
import {
  validateCryptoSecrets,
  isTriviallyWeakSecret,
} from '@/lib/security/validate-secrets';
import {
  sanitizeFileName,
  formatContentDisposition,
} from '@/lib/security/filename';
import {
  saveDocument,
  deleteDocumentFiles,
  readDocument,
} from '@/lib/storage/secureStorage';

describe('FIX 1: Cryptographic Key Separation (SV-02)', () => {
  describe('Secret Isolation and Reuse Prevention', () => {
    it('uses distinct secrets for encryption, OTP HMAC, and session HMAC', () => {
      const encKey = process.env.ENCRYPTION_KEY;
      const kekKey = process.env.KEK_KEY;
      const otpSecret = getOtpHmacSecret();
      const sessionSecret = getSessionSecret();

      expect(encKey).toBeDefined();
      expect(kekKey).toBeDefined();
      expect(otpSecret).toBeDefined();
      expect(sessionSecret).toBeDefined();

      expect(encKey).not.toEqual(otpSecret);
      expect(encKey).not.toEqual(sessionSecret);
      expect(kekKey).not.toEqual(otpSecret);
      expect(kekKey).not.toEqual(sessionSecret);
      expect(otpSecret).not.toEqual(sessionSecret);
    });

    it('getOtpHmacSecret throws when OTP_HMAC_SECRET is missing', () => {
      const original = process.env.OTP_HMAC_SECRET;
      delete process.env.OTP_HMAC_SECRET;
      try {
        expect(() => getOtpHmacSecret()).toThrow(/OTP_HMAC_SECRET is required/);
      } finally {
        process.env.OTP_HMAC_SECRET = original;
      }
    });

    it('getOtpHmacSecret rejects if set identical to ENCRYPTION_KEY', () => {
      const original = process.env.OTP_HMAC_SECRET;
      process.env.OTP_HMAC_SECRET = process.env.ENCRYPTION_KEY;
      try {
        expect(() => getOtpHmacSecret()).toThrow(/must not match ENCRYPTION_KEY/);
      } finally {
        process.env.OTP_HMAC_SECRET = original;
      }
    });

    it('getSessionSecret throws when SESSION_HMAC_SECRET is missing', () => {
      const original = process.env.SESSION_HMAC_SECRET;
      delete process.env.SESSION_HMAC_SECRET;
      try {
        expect(() => getSessionSecret()).toThrow(/SESSION_HMAC_SECRET is required/);
      } finally {
        process.env.SESSION_HMAC_SECRET = original;
      }
    });

    it('getSessionSecret rejects if set identical to ENCRYPTION_KEY', () => {
      const original = process.env.SESSION_HMAC_SECRET;
      process.env.SESSION_HMAC_SECRET = process.env.ENCRYPTION_KEY;
      try {
        expect(() => getSessionSecret()).toThrow(/must not match ENCRYPTION_KEY/);
      } finally {
        process.env.SESSION_HMAC_SECRET = original;
      }
    });
  });

  describe('OTP Generation & Verification', () => {
    it('generates a 6-digit numeric OTP', () => {
      const otp = generateOTP();
      expect(otp).toMatch(/^\d{6}$/);
    });

    it('hashes and verifies OTP with dedicated secret', async () => {
      const otp = '849201';
      const hash = hashOTPSync(otp);
      expect(typeof hash).toBe('string');
      expect(hash.length).toBe(64); // SHA-256 hex

      expect(await verifyOTPHash(otp, hash)).toBe(true);
      expect(await verifyOTPHash('000000', hash)).toBe(false);
    });

    it('never verifies OTP hash signed with ENCRYPTION_KEY (no insecure fallback)', async () => {
      const otp = '123456';
      // Compute hash manually with ENCRYPTION_KEY (the old insecure behavior)
      const legacyKeyHash = crypto
        .createHmac('sha256', process.env.ENCRYPTION_KEY!)
        .update(otp)
        .digest('hex');

      // The new verifyOTPHash MUST reject this to prevent key reuse attacks
      expect(await verifyOTPHash(otp, legacyKeyHash)).toBe(false);
    });

    it('supports safe OTP key rotation via OTP_HMAC_SECRET_OLD', async () => {
      const oldSecret = 'old-otp-hmac-secret-min-32-chars-rotation!';
      const otp = '654321';
      const oldHash = crypto.createHmac('sha256', oldSecret).update(otp).digest('hex');

      process.env.OTP_HMAC_SECRET_OLD = oldSecret;
      try {
        expect(await verifyOTPHash(otp, oldHash)).toBe(true);
      } finally {
        delete process.env.OTP_HMAC_SECRET_OLD;
      }
    });

    it('supports legacy bcrypt OTP hashes for backwards compatibility', async () => {
      const bcrypt = (await import('bcryptjs')).default;
      const otp = '777888';
      const bcryptHash = await bcrypt.hash(otp, 6);

      expect(await verifyOTPHash(otp, bcryptHash)).toBe(true);
      expect(await verifyOTPHash('000000', bcryptHash)).toBe(false);
    });
  });

  describe('Session Signing & Verification', () => {
    it('mints and verifies share session with SESSION_HMAC_SECRET', () => {
      const shareToken = 'token-abc-123';
      const minted = mintShareSession(shareToken, 3600, 'vendor@example.com');
      expect(minted.cookieValue.split('.')).toHaveLength(4);

      const verified = verifyShareSession(minted.cookieValue, shareToken);
      expect(verified.valid).toBe(true);
      if (verified.valid) {
        expect(verified.vendorEmail).toBe('vendor@example.com');
        expect(verified.sessionId).toBe(minted.sessionId);
      }
    });

    it('rejects tampered session token or altered email', () => {
      const shareToken = 'token-abc-123';
      const minted = mintShareSession(shareToken, 3600, 'vendor@example.com');
      const parts = minted.cookieValue.split('.');

      // Alter email segment
      parts[2] = Buffer.from('attacker@evil.com').toString('base64url');
      const tampered = parts.join('.');

      expect(verifyShareSession(tampered, shareToken).valid).toBe(false);
    });

    it('rejects session cookie signed with ENCRYPTION_KEY', () => {
      const shareToken = 'token-xyz';
      const sessionId = 'session-123';
      const expiresAt = Math.floor(Date.now() / 1000) + 3600;
      const email = 'vendor@example.com';
      const payload = `${shareToken}:${sessionId}:${expiresAt}:${email}`;
      const forgedMac = crypto.createHmac('sha256', process.env.ENCRYPTION_KEY!).update(payload).digest('hex');
      const forgedCookie = `${sessionId}.${expiresAt}.${Buffer.from(email).toString('base64url')}.${forgedMac}`;

      expect(verifyShareSession(forgedCookie, shareToken).valid).toBe(false);
    });

    it('supports safe session secret rotation via SESSION_HMAC_SECRET_OLD', () => {
      const oldSecret = 'old-session-hmac-secret-at-least-32-chars!';
      const shareToken = 'token-rotation-test';
      const sessionId = 'session-rot';
      const expiresAt = Math.floor(Date.now() / 1000) + 3600;
      const email = 'vendor@example.com';
      const payload = `${shareToken}:${sessionId}:${expiresAt}:${email}`;
      const mac = crypto.createHmac('sha256', oldSecret).update(payload).digest('hex');
      const cookie = `${sessionId}.${expiresAt}.${Buffer.from(email).toString('base64url')}.${mac}`;

      process.env.SESSION_HMAC_SECRET_OLD = oldSecret;
      try {
        const verified = verifyShareSession(cookie, shareToken);
        expect(verified.valid).toBe(true);
      } finally {
        delete process.env.SESSION_HMAC_SECRET_OLD;
      }
    });

    it('preserves active sessions signed with NEXTAUTH_SECRET during migration window', () => {
      const shareToken = 'migration-link';
      const sessionId = 'session-mig';
      const expiresAt = Math.floor(Date.now() / 1000) + 3600;
      const email = 'vendor@example.com';
      const payload = `${shareToken}:${sessionId}:${expiresAt}:${email}`;
      const mac = crypto.createHmac('sha256', process.env.NEXTAUTH_SECRET!).update(payload).digest('hex');
      const cookie = `${sessionId}.${expiresAt}.${Buffer.from(email).toString('base64url')}.${mac}`;

      const verified = verifyShareSession(cookie, shareToken);
      expect(verified.valid).toBe(true);
    });
  });

  describe('Data Encryption, DEK Envelope & Key Rotation', () => {
    it('preserves compatibility with existing 3-part encrypted data format', () => {
      const payload = { userId: 'u123', secretNote: 'confidential contract' };
      const encrypted = encryptData(payload);
      expect(encrypted.split(':')).toHaveLength(3);

      const decrypted = decryptData<typeof payload>(encrypted);
      expect(decrypted).toEqual(payload);
    });

    it('supports versioned ciphertext format (v1:iv:authTag:ciphertext)', () => {
      const payload = { versioned: true, data: 42 };
      const rawEncrypted = encryptData(payload);
      const versioned = `v1:${rawEncrypted}`;

      const decrypted = decryptData<typeof payload>(versioned);
      expect(decrypted).toEqual(payload);
    });

    it('supports safe ENCRYPTION_KEY rotation with ENCRYPTION_KEY_OLD', () => {
      const oldKey = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
      const newKey = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';

      // Encrypt with old key
      const iv = crypto.randomBytes(16);
      const cipher = crypto.createCipheriv('aes-256-gcm', Buffer.from(oldKey, 'hex'), iv);
      const plaintext = JSON.stringify({ sensitive: 'legacy-data' });
      let ct = cipher.update(plaintext, 'utf8', 'hex');
      ct += cipher.final('hex');
      const authTag = cipher.getAuthTag();
      const legacyCiphertext = `${iv.toString('hex')}:${authTag.toString('hex')}:${ct}`;

      // Set new key as active, old key as rotated
      const originalKey = process.env.ENCRYPTION_KEY;
      process.env.ENCRYPTION_KEY = newKey;
      process.env.ENCRYPTION_KEY_OLD = oldKey;

      try {
        const decrypted = decryptData<{ sensitive: string }>(legacyCiphertext);
        expect(decrypted.sensitive).toBe('legacy-data');
      } finally {
        process.env.ENCRYPTION_KEY = originalKey;
        delete process.env.ENCRYPTION_KEY_OLD;
      }
    });

    it('wraps and unwraps DEK with KEK_KEY', () => {
      const dek = generateDek();
      const wrapped = encryptDek(dek);
      const unwrapped = decryptDek(wrapped);
      expect(unwrapped.equals(dek)).toBe(true);
    });

    it('preserves DEK backwards compatibility: decrypts DEK encrypted with ENCRYPTION_KEY', () => {
      const dek = generateDek();
      const legacyKey = Buffer.from(process.env.ENCRYPTION_KEY!, 'hex');
      const iv = crypto.randomBytes(16);
      const cipher = crypto.createCipheriv('aes-256-gcm', legacyKey, iv);
      const enc = Buffer.concat([cipher.update(dek), cipher.final()]);
      const authTag = cipher.getAuthTag();
      const legacyEncryptedDek = `${iv.toString('hex')}:${authTag.toString('hex')}:${enc.toString('hex')}`;

      // decryptDek should fall back to legacy ENCRYPTION_KEY for pre-KEK files
      const decrypted = decryptDek(legacyEncryptedDek);
      expect(decrypted.equals(dek)).toBe(true);
    });
  });

  describe('Startup Secret Validation (validateCryptoSecrets)', () => {
    const validEnv: NodeJS.ProcessEnv = {
      NODE_ENV: 'test',
      ENCRYPTION_KEY: TEST_ENCRYPTION_KEY,
      KEK_KEY: TEST_KEK_KEY,
      OTP_HMAC_SECRET: TEST_OTP_SECRET,
      SESSION_HMAC_SECRET: TEST_SESSION_SECRET,
      NEXTAUTH_SECRET: TEST_NEXTAUTH_SECRET,
    };

    it('passes with all distinct, strong secrets', () => {
      expect(() => validateCryptoSecrets(validEnv)).not.toThrow();
    });

    it('rejects missing ENCRYPTION_KEY', () => {
      const env = { ...validEnv, ENCRYPTION_KEY: '' };
      expect(() => validateCryptoSecrets(env)).toThrow(/ENCRYPTION_KEY.*missing/);
    });

    it('rejects missing OTP_HMAC_SECRET', () => {
      const env = { ...validEnv, OTP_HMAC_SECRET: '' };
      expect(() => validateCryptoSecrets(env)).toThrow(/OTP_HMAC_SECRET.*missing/);
    });

    it('rejects short secret (< 32 chars)', () => {
      const env = { ...validEnv, OTP_HMAC_SECRET: 'too-short-secret' };
      expect(() => validateCryptoSecrets(env)).toThrow(/too short/);
    });

    it('rejects non-hex ENCRYPTION_KEY', () => {
      const env = { ...validEnv, ENCRYPTION_KEY: 'z'.repeat(64) };
      expect(() => validateCryptoSecrets(env)).toThrow(/invalid format/);
    });

    it('rejects duplicate secrets (key confusion prevention)', () => {
      const env = { ...validEnv, OTP_HMAC_SECRET: TEST_SESSION_SECRET };
      expect(() => validateCryptoSecrets(env)).toThrow(/cryptographic secrets MUST be distinct/);
    });

    it('rejects weak repeated-character secrets', () => {
      expect(isTriviallyWeakSecret('a'.repeat(32))).toBe(true);
      expect(isTriviallyWeakSecret('0'.repeat(64))).toBe(true);
      expect(isTriviallyWeakSecret('password123')).toBe(true);
      expect(isTriviallyWeakSecret(TEST_OTP_SECRET)).toBe(false);

      const env = { ...validEnv, OTP_HMAC_SECRET: 'x'.repeat(40) };
      expect(() => validateCryptoSecrets(env)).toThrow(/dangerously weak/);
    });
  });
});

describe('FIX 3: Filename Security (SV-01)', () => {
  const allowed = new Set(['pdf', 'docx', 'xlsx', 'txt']);

  describe('sanitizeFileName', () => {
    it('preserves valid filenames and allowed extensions', () => {
      const res = sanitizeFileName('Financial Report 2026.pdf', allowed);
      expect(res.sanitizedFileName).toBe('Financial Report 2026.pdf');
      expect(res.extension).toBe('pdf');
    });

    it('removes CRLF characters to prevent HTTP response splitting', () => {
      const res = sanitizeFileName('invoice\r\nSet-Cookie:admin=1.docx', allowed);
      expect(res.sanitizedFileName).toBe('invoiceSet-Cookie_admin=1.docx');
      expect(res.sanitizedFileName).not.toContain('\r');
      expect(res.sanitizedFileName).not.toContain('\n');
    });

    it('removes null bytes (literal and percent-encoded)', () => {
      const res = sanitizeFileName('contract\0file%00.pdf', allowed);
      expect(res.sanitizedFileName).toBe('contractfile.pdf');
      expect(res.sanitizedFileName).not.toContain('\0');
    });

    it('strips Unix and Windows directory traversal paths', () => {
      const unixTraversal = sanitizeFileName('../../../../etc/passwd.pdf', allowed);
      expect(unixTraversal.sanitizedFileName).toBe('passwd.pdf');

      const winTraversal = sanitizeFileName('..\\..\\windows\\system32\\hosts.txt', allowed);
      expect(winTraversal.sanitizedFileName).toBe('hosts.txt');
    });

    it('strips Unicode directional formatting override characters (RLO attack)', () => {
      // \u202E is Right-to-Left Override
      const rloAttack = sanitizeFileName('document\u202Efdp.docx', allowed);
      expect(rloAttack.sanitizedFileName).toBe('documentfdp.docx');
    });

    it('rejects dangerous and unlisted extensions', () => {
      expect(() => sanitizeFileName('malicious.exe', allowed)).toThrow(/not allowed/);
      expect(() => sanitizeFileName('script.sh', allowed)).toThrow(/not allowed/);
      expect(() => sanitizeFileName('webshell.php', allowed)).toThrow(/not allowed/);
      expect(() => sanitizeFileName('noextension', allowed)).toThrow(/valid extension/);
    });

    it('enforces maximum filename base length (<= 100 characters)', () => {
      const longName = 'a'.repeat(200) + '.xlsx';
      const res = sanitizeFileName(longName, allowed);
      expect(res.baseName.length).toBeLessThanOrEqual(100);
      expect(res.extension).toBe('xlsx');
      expect(res.sanitizedFileName.endsWith('.xlsx')).toBe(true);
    });

    it('falls back to safe default if base name becomes empty after sanitization', () => {
      const res = sanitizeFileName('...///\r\n.pdf', allowed);
      expect(res.sanitizedFileName).toBe('document.pdf');
    });
  });

  describe('formatContentDisposition', () => {
    it('formats safe standard ASCII headers', () => {
      const header = formatContentDisposition('attachment', 'report.pdf');
      expect(header).toBe(`attachment; filename="report.pdf"; filename*=UTF-8''report.pdf`);
    });

    it('strips CRLF to eliminate header injection attacks', () => {
      const header = formatContentDisposition('attachment', 'report\r\nSet-Cookie: evil=1\r\n.pdf');
      expect(header).not.toContain('\r');
      expect(header).not.toContain('\n');
    });

    it('escapes quotes and backslashes in ASCII fallback', () => {
      const header = formatContentDisposition('inline', 'test"file\\name.docx');
      expect(header).toContain('filename="test_file_name.docx"');
    });

    it('RFC 5987 encodes special characters and Unicode in filename*', () => {
      const header = formatContentDisposition('attachment', 'résumé (final)*.pdf');
      // parens and asterisks encoded, unicode percent-encoded
      expect(header).toContain(`filename*=UTF-8''r%C3%A9sum%C3%A9%20%28final%29%2A.pdf`);
    });
  });
});

describe('FIX 2: Upload Data Consistency (DL-01)', () => {
  const testDocId = `test-upload-${Date.now()}`;
  const testBuffer = Buffer.from('PDF test content for consistency test');

  afterEach(async () => {
    try {
      await deleteDocumentFiles(testDocId);
    } catch {}
  });

  it('saveDocument writes atomically with temporary file and cleans up on success', async () => {
    const { storagePath, absolutePath } = await saveDocument(testDocId, 'contract.pdf', testBuffer);

    expect(storagePath).toContain('contract.pdf');
    const readBack = await readDocument(storagePath);
    expect(readBack.equals(testBuffer)).toBe(true);

    // Verify no leftover .tmp files in the directory
    const dir = path.dirname(absolutePath);
    const files = await fs.readdir(dir);
    const tmpFiles = files.filter(f => f.endsWith('.tmp'));
    expect(tmpFiles).toHaveLength(0);
  });

  it('deleteDocumentFiles cleans up physical files completely', async () => {
    const { storagePath } = await saveDocument(testDocId, 'to-delete.pdf', testBuffer);
    await deleteDocumentFiles(testDocId);

    // Reading after cleanup must fail
    await expect(readDocument(storagePath)).rejects.toThrow();
  });

  it('concurrent uploads with the same filename do not overwrite each other', async () => {
    const docId1 = `concurrent-1-${Date.now()}`;
    const docId2 = `concurrent-2-${Date.now()}`;
    const docId3 = `concurrent-3-${Date.now()}`;

    const buf1 = Buffer.from('Content for upload 1');
    const buf2 = Buffer.from('Content for upload 2 (different)');
    const buf3 = Buffer.from('Content for upload 3 (third version)');

    try {
      // Simulate 3 concurrent uploads with identical filename 'financials.pdf'
      const [res1, res2, res3] = await Promise.all([
        saveDocument(docId1, 'financials.pdf', buf1),
        saveDocument(docId2, 'financials.pdf', buf2),
        saveDocument(docId3, 'financials.pdf', buf3),
      ]);

      // All 3 storage paths must be distinct
      expect(res1.storagePath).not.toEqual(res2.storagePath);
      expect(res2.storagePath).not.toEqual(res3.storagePath);

      // Contents must match their respective buffers (no overwrites)
      const read1 = await readDocument(res1.storagePath);
      const read2 = await readDocument(res2.storagePath);
      const read3 = await readDocument(res3.storagePath);

      expect(read1.equals(buf1)).toBe(true);
      expect(read2.equals(buf2)).toBe(true);
      expect(read3.equals(buf3)).toBe(true);
    } finally {
      await Promise.all([
        deleteDocumentFiles(docId1).catch(() => {}),
        deleteDocumentFiles(docId2).catch(() => {}),
        deleteDocumentFiles(docId3).catch(() => {}),
      ]);
    }
  });
});
