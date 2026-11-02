import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

process.env.ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || '6e7f87c312aa5a9d1d45434ae1edbc32cf9a2b6e52a7d592eb24fce9827b8f41';
process.env.KEK_KEY = process.env.KEK_KEY || '7672891e32cf490be6f8740a1c988fb86fa605f0981e6209fbfd96a0b7ea5cd4';
process.env.OTP_HMAC_SECRET = process.env.OTP_HMAC_SECRET || 'test-otp-hmac-secret-min-32-chars-for-dev!!';
process.env.SESSION_HMAC_SECRET = process.env.SESSION_HMAC_SECRET || 'test-session-hmac-secret-min-32-chars-for-dev!!';
process.env.NEXTAUTH_SECRET = process.env.NEXTAUTH_SECRET || 'eA5TBa9rO9uMP4Sp2zLiXfRaeBXJ11kNkFbOifhbQh18=';
process.env.CRON_SECRET = process.env.CRON_SECRET || 'tbMRH299fGGJNBCRiMZUmZ1Ft5C7Gx8GEyq6Pr_v5AU';

import { validateCSRF } from '@/lib/security/csrf';
import { extractClientIP } from '@/lib/rate-limit';
import { mintShareSession, verifyShareSession } from '@/lib/share-session';
import { sanitizeFileName, formatContentDisposition } from '@/lib/security/filename';
import { validateMagicBytesForExtension } from '@/lib/file-magic';
import { normalizeRole, canCreateSecureLinks } from '@/lib/security/roles';
import { buildCspHeader, generateCspNonce } from '@/lib/security/csp';
import { validateCryptoSecrets, isTriviallyWeakSecret } from '@/lib/security/validate-secrets';

describe('CONTROLLED PENETRATION & NEGATIVE SECURITY TEST SUITE', () => {

  describe('1. CSRF Attack Simulations', () => {
    it('Blocks mutating POST with cross-origin attacker Origin', () => {
      const res = validateCSRF({
        method: 'POST',
        headers: new Headers({ origin: 'https://evil-attacker.com', host: 'localhost:3000' }),
      });
      expect(res.allowed).toBe(false);
      if (!res.allowed) {
        expect(res.status).toBe(403);
        expect(res.reason).toMatch(/Origin mismatch/i);
      }
    });

    it('Blocks mutating POST with cross-origin Referer', () => {
      const res = validateCSRF({
        method: 'POST',
        headers: new Headers({ referer: 'https://evil-attacker.com/exploit', host: 'localhost:3000' }),
      });
      expect(res.allowed).toBe(false);
      if (!res.allowed) {
        expect(res.status).toBe(403);
        expect(res.reason).toMatch(/Referer mismatch/i);
      }
    });

    it('Fails closed on mutating POST missing both Origin and Referer', () => {
      const res = validateCSRF({
        method: 'POST',
        headers: new Headers({ host: 'localhost:3000' }),
      });
      expect(res.allowed).toBe(false);
      if (!res.allowed) {
        expect(res.status).toBe(403);
        expect(res.reason).toMatch(/Missing Origin\/Referer/i);
      }
    });

    it('Allows legitimate same-origin mutating POST', () => {
      const res = validateCSRF({
        method: 'POST',
        headers: new Headers({ origin: 'http://localhost:3000', host: 'localhost:3000' }),
      });
      expect(res.allowed).toBe(true);
    });
  });

  describe('2. IP Spoofing & Rate-Limit Bypass Simulations', () => {
    it('Untrusted client cannot forge IP via leftmost X-Forwarded-For hop', () => {
      delete process.env.TRUSTED_PROXIES;
      delete process.env.TRUST_CLOUDFLARE_PROXY;

      const untrustedHeaders = new Headers({
        'x-forwarded-for': '198.51.100.1, 10.0.0.1',
      });
      const resolved = extractClientIP(untrustedHeaders);
      expect(resolved).toBe('10.0.0.1');
    });
  });

  describe('3. Session Authentication & MAC Forgery Simulations', () => {
    it('Rejects forged session HMAC signatures', () => {
      const legitimate = mintShareSession('target-token-123', 300, 'vendor@corp.com');
      const forged = `${legitimate.sessionId}.${legitimate.expiresAt}.${Buffer.from('vendor@corp.com').toString('base64url')}.deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef`;
      const res = verifyShareSession(forged, 'target-token-123');
      expect(res.valid).toBe(false);
    });

    it('Prevents cross-token session cookie reuse (token-binding)', () => {
      const legitimate = mintShareSession('token-A', 300, 'vendor@corp.com');
      const res = verifyShareSession(legitimate.cookieValue, 'token-B');
      expect(res.valid).toBe(false);
    });

    it('Prevents vendor email swapping inside valid session cookie', () => {
      const legitimate = mintShareSession('token-A', 300, 'alice@corp.com');
      const parts = legitimate.cookieValue.split('.');
      const bobB64 = Buffer.from('bob@corp.com', 'utf8').toString('base64url');
      const tampered = `${parts[0]}.${parts[1]}.${bobB64}.${parts[3]}`;
      const res = verifyShareSession(tampered, 'token-A');
      expect(res.valid).toBe(false);
    });
  });

  describe('4. File Upload & Path Traversal Simulations', () => {
    const allowed = new Set(['pdf', 'docx', 'xlsx']);

    it('Strips path traversal directory sequences from filenames', () => {
      const sanitized = sanitizeFileName('../../../../etc/passwd.pdf', allowed);
      expect(sanitized.sanitizedFileName).toBe('passwd.pdf');
      expect(sanitized.sanitizedFileName).not.toContain('/');
      expect(sanitized.sanitizedFileName).not.toContain('..');
    });

    it('Rejects executable and disallowed file extensions', () => {
      expect(() => sanitizeFileName('payload.exe', allowed)).toThrow(/not allowed/i);
      expect(() => sanitizeFileName('payload.php', allowed)).toThrow(/not allowed/i);
      expect(() => sanitizeFileName('payload.sh', allowed)).toThrow(/not allowed/i);
    });

    it('Strips CRLF and null-byte injection from filenames', () => {
      const sanitized = sanitizeFileName('report\r\nSet-Cookie: evil=1\0.pdf', allowed);
      expect(sanitized.sanitizedFileName).not.toContain('\r');
      expect(sanitized.sanitizedFileName).not.toContain('\n');
      expect(sanitized.sanitizedFileName).not.toContain('\0');
    });

    it('Detects and blocks magic-byte spoofing (bash script masked as PDF)', () => {
      const fakePdf = Buffer.from('#!/bin/bash\necho "pwned"\n');
      const valid = validateMagicBytesForExtension(fakePdf, 'pdf');
      expect(valid).toBe(false);
    });

    it('Validates authentic PDF magic bytes (%PDF-)', () => {
      const realPdf = Buffer.from('%PDF-1.7\n%c00l');
      const valid = validateMagicBytesForExtension(realPdf, 'pdf');
      expect(valid).toBe(true);
    });
  });

  describe('5. Content-Disposition Header Injection Verification', () => {
    it('Neutralizes header injection via RFC 6266 and RFC 5987 formatting', () => {
      const attackName = 'test"; filename="pwned.exe';
      const cd = formatContentDisposition('attachment', attackName);
      expect(cd).not.toContain('filename="test"; filename="pwned.exe"');
      expect(cd).toMatch(/^attachment; filename="[^"\r\n]+"; filename\*=UTF-8''/);
    });
  });

  describe('6. Production CSP vs Next.js 16 Dynamic Nonce Propagation Verification', () => {
    it('VERIFIES REMEDIATION: Production CSP script-src demands nonce with strict-dynamic and NO unsafe-inline', () => {
      const nonce = generateCspNonce();
      const prodCsp = buildCspHeader(nonce, { isDev: false, pathname: '/' });
      const directives = prodCsp.split(';').map(d => d.trim());
      const scriptSrc = directives.find(d => d.startsWith('script-src')) || '';

      // The production CSP script-src directive enforces nonce and strict-dynamic:
      expect(scriptSrc).toContain(`'nonce-${nonce}'`);
      expect(scriptSrc).toContain("'strict-dynamic'");
      expect(scriptSrc).not.toContain("'unsafe-inline'");
    });
  });

  describe('7. RBAC Privilege Escalation Prevention', () => {
    it('Prevents arbitrary role escalation to ADMIN or SUPER_ADMIN', () => {
      expect(normalizeRole('ADMIN')).toBe('VENDOR');
      expect(normalizeRole('SUPER_ADMIN')).toBe('VENDOR');
      expect(canCreateSecureLinks('OWNER')).toBe(true);
      expect(canCreateSecureLinks('VENDOR')).toBe(false);
      expect(canCreateSecureLinks('ADMIN')).toBe(false);
    });
  });
});
