/**
 * Encrypt → decrypt contracts for link create + view.
 */

process.env.ENCRYPTION_KEY =
  process.env.ENCRYPTION_KEY ||
  '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
process.env.KEK_KEY =
  process.env.KEK_KEY ||
  'fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210';
process.env.OTP_HMAC_SECRET =
  process.env.OTP_HMAC_SECRET || 'test-otp-hmac-secret-min-32-chars!!!!';

import {
  encryptData,
  decryptData,
  generateDek,
  encryptDek,
  decryptDek,
  encryptBuffer,
  decryptBuffer,
  generateDataHash,
  hashOTP,
  verifyOTPHash,
} from '@/lib/crypto';

describe('PII encrypt/decrypt (link create → view)', () => {
  it('round-trips user payload', () => {
    const userData = {
      firstName: 'Ada',
      lastName: 'Lovelace',
      email: 'ada@example.com',
      phone: '+15551212',
      gender: 'F',
      age: 36,
    };
    const encrypted = encryptData(userData);
    expect(encrypted.split(':')).toHaveLength(3);
    expect(decryptData<typeof userData>(encrypted)).toEqual(userData);
  });

  it('rejects tampered ciphertext', () => {
    const encrypted = encryptData({ firstName: 'Ada' });
    const parts = encrypted.split(':');
    const last = parts[2].slice(-1);
    parts[2] = parts[2].slice(0, -1) + (last === '0' ? '1' : '0');
    expect(() => decryptData(parts.join(':'))).toThrow();
  });

  it('rejects malformed payload', () => {
    expect(() => decryptData('not-valid')).toThrow(/Invalid encrypted data format/);
  });
});

describe('file envelope DEK (create-link GridFS path)', () => {
  it('wraps DEK with KEK and unwraps for decryptBuffer', () => {
    const dek = generateDek();
    const wrapped = encryptDek(dek);
    const unwrapped = decryptDek(wrapped);
    expect(unwrapped.equals(dek)).toBe(true);

    const plain = Buffer.from('confidential-bytes');
    const { iv, authTag, encryptedContent } = encryptBuffer(plain, dek);
    expect(decryptBuffer(encryptedContent, iv, authTag, unwrapped).equals(plain)).toBe(true);
  });

  it('integrity hash is stable for the same object', () => {
    const data = { firstName: 'Ada', age: 36 };
    expect(generateDataHash(data)).toBe(generateDataHash(data));
    expect(generateDataHash(data)).not.toBe(generateDataHash({ ...data, age: 37 }));
  });
});

describe('OTP hash used at link create', () => {
  it('HMAC OTP verifies with timing-safe compare', async () => {
    const otp = '482193';
    const hash = await hashOTP(otp);
    expect(await verifyOTPHash(otp, hash)).toBe(true);
    expect(await verifyOTPHash('000000', hash)).toBe(false);
  });
});
