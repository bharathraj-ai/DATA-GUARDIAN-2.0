/**
 * Phase 2 security-hardening contracts.
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

import { validateMimeType } from '@/lib/security/file-validator';
import { hashAuditEntry, verifyAuditEntry } from '@/lib/security/audit-chain';
import { parseVendorEmails, vendorEmailEqualsWhere } from '@/lib/send-record';
import { hashOTP, verifyOTPHash } from '@/lib/crypto';

describe('HTML is not accepted as Excel', () => {
  it('rejects HTML saved as .xls', () => {
    const buf = Buffer.from('<html><table><tr><td>secret</td></tr></table></html>');
    const result = validateMimeType(buf, '.xls');
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/HTML/i);
  });

  it('rejects HTML saved as .xlsx', () => {
    const buf = Buffer.from('<!DOCTYPE html><table></table>');
    const result = validateMimeType(buf, '.xlsx');
    expect(result.valid).toBe(false);
  });
});

describe('OTP HMAC does not accept ENCRYPTION_KEY', () => {
  it('verifies only with OTP_HMAC_SECRET', async () => {
    const otp = '654321';
    const hash = await hashOTP(otp);
    expect(await verifyOTPHash(otp, hash)).toBe(true);
    const src = await import('fs/promises').then((fs) =>
      fs.readFile(require('path').join(process.cwd(), 'src/lib/crypto.ts'), 'utf8'),
    );
    expect(src).not.toMatch(/OTP_HMAC_SECRET,\s*\n\s*process\.env\.ENCRYPTION_KEY/);
  });
});

describe('vendor email exact match', () => {
  it('parses comma lists and builds equals filters', () => {
    expect(parseVendorEmails('Ada@X.com, bob@y.com')).toEqual(['ada@x.com', 'bob@y.com']);
    expect(vendorEmailEqualsWhere('Joann@co.com')).toEqual({
      vendorEmail: { equals: 'joann@co.com', mode: 'insensitive' },
    });
  });
});

describe('audit HMAC chain', () => {
  it('round-trips and detects tampering', () => {
    const genesis = '0'.repeat(64);
    const params = {
      prevHash: genesis,
      action: 'CREATED',
      timestamp: '2026-08-14T00:00:00.000Z',
      linkId: 'link1',
      ownerId: 'owner1',
      reason: '',
      metadata: '{}',
    };
    const hash = hashAuditEntry(params);
    expect(verifyAuditEntry(params, hash)).toBe(true);
    expect(verifyAuditEntry({ ...params, action: 'REVOKED' }, hash)).toBe(false);
  });
});

describe('phase-2 source contracts', () => {
  it('does not advertise zero-knowledge on the landing page', async () => {
    const fs = await import('fs/promises');
    const path = await import('path');
    const src = await fs.readFile(path.join(process.cwd(), 'src/app/page.tsx'), 'utf8');
    expect(src).not.toMatch(/Zero-Knowledge Architecture/);
    expect(src).not.toMatch(/End-to-End Encrypted/);
    expect(src).toMatch(/Zero-Trust Access/);
    expect(src).toMatch(/not zero-knowledge encryption/);
  });

  it('document stream requires download capability', async () => {
    const fs = await import('fs/promises');
    const path = await import('path');
    const src = await fs.readFile(
      path.join(process.cwd(), 'src/app/api/documents/[fileId]/stream/route.ts'),
      'utf8',
    );
    expect(src).toMatch(/action:\s*'download'/);
    expect(src).not.toMatch(/download_or_edit/);
  });

  it('share-session HMAC verify does not use ENCRYPTION_KEY', async () => {
    const fs = await import('fs/promises');
    const path = await import('path');
    const src = await fs.readFile(path.join(process.cwd(), 'src/lib/share-session.ts'), 'utf8');
    expect(src).not.toMatch(/process\.env\.ENCRYPTION_KEY/);
  });

  it('vendor inbox does not use contains on SendRecord emails', async () => {
    const fs = await import('fs/promises');
    const path = await import('path');
    const src = await fs.readFile(path.join(process.cwd(), 'src/actions/dashboard.ts'), 'utf8');
    expect(src).not.toMatch(/vendorEmail:\s*\{\s*contains:/);
    expect(src).toMatch(/vendorEmailEqualsWhere/);
  });

  it('create-link stages files through the malware scan hook', async () => {
    const fs = await import('fs/promises');
    const path = await import('path');
    const src = await fs.readFile(path.join(process.cwd(), 'src/lib/create-link-stage.ts'), 'utf8');
    expect(src).toMatch(/scanUploadBuffer/);
    expect(src).toMatch(/assertScanAllowed/);
    const scan = await fs.readFile(
      path.join(process.cwd(), 'src/lib/security/malware-scan.ts'),
      'utf8',
    );
    expect(scan).toMatch(/AWS_LAMBDA_SCAN_FUNCTION/);
    expect(scan).toMatch(/InvokeCommand/);
    expect(scan).toMatch(/contentBase64/);
    expect(scan).not.toMatch(/s3Put|@\/lib\/s3/);
  });
});
