/**
 * Phase 4 enterprise contracts.
 */

import { isMarketingPath } from '@/lib/marketing-paths';
import { emailDomain, isConsumerEmailDomain, assertEmailAllowedForHostedDomain } from '@/lib/tenant';
import { kmsHttpEnabled } from '@/lib/security/kms';

describe('tenant helpers', () => {
  it('treats gmail as consumer and acme.com as company', () => {
    expect(emailDomain('Ada@Acme.COM')).toBe('acme.com');
    expect(isConsumerEmailDomain('gmail.com')).toBe(true);
    expect(isConsumerEmailDomain('acme.com')).toBe(false);
  });

  it('enforces GOOGLE_HOSTED_DOMAIN when set', () => {
    const prev = process.env.GOOGLE_HOSTED_DOMAIN;
    process.env.GOOGLE_HOSTED_DOMAIN = 'acme.com';
    expect(assertEmailAllowedForHostedDomain('ada@acme.com')).toBe(true);
    expect(assertEmailAllowedForHostedDomain('ada@gmail.com')).toBe(false);
    if (prev === undefined) delete process.env.GOOGLE_HOSTED_DOMAIN;
    else process.env.GOOGLE_HOSTED_DOMAIN = prev;
  });
});

describe('kms hook', () => {
  it('is off unless wrap+unwrap URLs are set', () => {
    const wrap = process.env.KMS_WRAP_URL;
    const unwrap = process.env.KMS_UNWRAP_URL;
    delete process.env.KMS_WRAP_URL;
    delete process.env.KMS_UNWRAP_URL;
    expect(kmsHttpEnabled()).toBe(false);
    if (wrap) process.env.KMS_WRAP_URL = wrap;
    if (unwrap) process.env.KMS_UNWRAP_URL = unwrap;
  });

  it('wraps DEKs with local KEK when HTTP KMS is unset', async () => {
    process.env.ENCRYPTION_KEY =
      process.env.ENCRYPTION_KEY ||
      '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
    process.env.KEK_KEY =
      process.env.KEK_KEY ||
      'fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210';
    delete process.env.KMS_WRAP_URL;
    delete process.env.KMS_UNWRAP_URL;
    const { wrapDek, unwrapDek } = await import('@/lib/security/kms');
    const { generateDek } = await import('@/lib/crypto');
    const dek = generateDek();
    const wrapped = await wrapDek(dek);
    expect(wrapped.startsWith('kms:http:')).toBe(false);
    await expect(unwrapDek(wrapped)).resolves.toEqual(dek);
  });
});

describe('phase-4 source contracts', () => {
  it('legacy disk upload and file stream return 410', async () => {
    const fs = await import('fs/promises');
    const path = await import('path');
    const upload = await fs.readFile(
      path.join(process.cwd(), 'src/app/api/documents/upload/route.ts'),
      'utf8',
    );
    const files = await fs.readFile(
      path.join(process.cwd(), 'src/app/api/files/[fileId]/route.ts'),
      'utf8',
    );
    const storage = await fs.readFile(
      path.join(process.cwd(), 'src/lib/storage/secureStorage.ts'),
      'utf8',
    );
    expect(upload).toMatch(/status: 410/);
    expect(files).toMatch(/status: 410/);
    expect(storage).toMatch(/Plaintext disk storage was removed/);
    expect(storage).not.toMatch(/fs\.writeFile/);
  });

  it('Prisma schema no longer has OnlyOffice Document tables', async () => {
    const fs = await import('fs/promises');
    const path = await import('path');
    const schema = await fs.readFile(path.join(process.cwd(), 'prisma/schema.prisma'), 'utf8');
    expect(schema).not.toMatch(/model DocumentGrant/);
    expect(schema).not.toMatch(/model DocumentAuditLog/);
    expect(schema).toMatch(/model Organization/);
    expect(schema).toMatch(/model FileViewEvent/);
  });

  it('does not reintroduce zero-knowledge claims', async () => {
    const fs = await import('fs/promises');
    const path = await import('path');
    const kms = await fs.readFile(
      path.join(process.cwd(), 'src/lib/security/kms.ts'),
      'utf8',
    );
    expect(kms).toMatch(/not zero-knowledge/);
    expect(isMarketingPath('/')).toBe(true);
    const howItWorks = await fs.readFile(
      path.join(process.cwd(), 'src/app/how-it-works/page.tsx'),
      'utf8',
    );
    expect(howItWorks).not.toMatch(/Zero knowledge/);
    expect(howItWorks).not.toMatch(/We never see your unencrypted data/);
  });

  it('auth supports optional OIDC and hosted-domain Google', async () => {
    const fs = await import('fs/promises');
    const path = await import('path');
    const auth = await fs.readFile(path.join(process.cwd(), 'src/lib/auth.ts'), 'utf8');
    expect(auth).toMatch(/OIDC_ISSUER/);
    expect(auth).toMatch(/GOOGLE_HOSTED_DOMAIN/);
    expect(auth).toMatch(/assertEmailAllowedForHostedDomain/);
  });

  it('sign-in can show an OIDC button and watermarks use session email', async () => {
    const fs = await import('fs/promises');
    const path = await import('path');
    const signin = await fs.readFile(path.join(process.cwd(), 'src/app/auth/signin/page.tsx'), 'utf8');
    const view = await fs.readFile(path.join(process.cwd(), 'src/app/view/[token]/page.tsx'), 'utf8');
    expect(signin).toMatch(/signIn\('oidc'/);
    expect(view).toMatch(/viewerEmail=\{data\.viewerEmail/);
  });
});
