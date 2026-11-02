import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { validateCryptoSecrets } from '@/lib/security/validate-secrets';

export { validateCryptoSecrets };

// ============================================
// TOKEN & OTP UTILITIES
// ============================================

/**
 * Generates a cryptographically secure token (UUID v4)
 */
export function generateSecureToken(): string {
    return crypto.randomUUID();
}

/**
 * Generates a cryptographically secure 6-digit OTP.
 * Uses crypto.randomInt for uniform distribution (no modulo bias).
 * SECURITY: The returned value must NEVER be logged, stored in plaintext, or returned in API responses.
 */
export function generateOTP(): string {
    return crypto.randomInt(100000, 999999).toString();
}

/**
 * Returns the dedicated OTP HMAC secret.
 *
 * OTP_HMAC_SECRET is MANDATORY and must NOT be the same value as
 * ENCRYPTION_KEY, KEK_KEY, NEXTAUTH_SECRET, or SESSION_HMAC_SECRET.
 * This prevents key-confusion attacks where a single leaked key
 * compromises all security primitives simultaneously.
 */
export function getOtpHmacSecret(): string {
    const secret = process.env.OTP_HMAC_SECRET;
    if (!secret) {
        throw new Error(
            'OTP_HMAC_SECRET is required for OTP hashing. ' +
            'Set a dedicated >=32-char secret that is NOT shared with ENCRYPTION_KEY or other secrets.'
        );
    }
    if (secret.length < 32) {
        throw new Error('OTP_HMAC_SECRET must be at least 32 characters');
    }
    // Strict isolation: ensure OTP_HMAC_SECRET is distinct from encryption keys
    if (process.env.ENCRYPTION_KEY && secret === process.env.ENCRYPTION_KEY) {
        throw new Error('OTP_HMAC_SECRET must not match ENCRYPTION_KEY');
    }
    if (process.env.KEK_KEY && secret === process.env.KEK_KEY) {
        throw new Error('OTP_HMAC_SECRET must not match KEK_KEY');
    }
    return secret;
}

/**
 * Hashes an OTP using HMAC-SHA256 (fast, secure for short-lived tokens)
 *
 * For 6-digit OTPs with 5-minute expiry and 3-attempt limit, HMAC is more appropriate
 * than bcrypt because:
 * - OTPs are short-lived (brute-force window is minimal)
 * - We need fast verification for good UX
 * - HMAC with a dedicated secret key provides sufficient security
 *
 * Always uses OTP_HMAC_SECRET — never falls back to ENCRYPTION_KEY.
 */
export function hashOTPSync(otp: string): string {
    return crypto.createHmac('sha256', getOtpHmacSecret()).update(otp).digest('hex');
}

export async function hashOTP(otp: string): Promise<string> {
    return hashOTPSync(otp);
}

/**
 * Verifies an OTP against its hash.
 *
 * Supports:
 * 1. Current HMAC-SHA256 hashes (OTP_HMAC_SECRET)
 * 2. Rotated HMAC secrets (OTP_HMAC_SECRET_PREVIOUS / OTP_HMAC_SECRET_OLD)
 * 3. Legacy bcrypt hashes ($2a$/$2b$/$2y$ prefixed)
 *
 * NOTE: Never reuses ENCRYPTION_KEY or KEK_KEY for HMAC verification.
 */
export async function verifyOTPHash(otp: string, hash: string): Promise<boolean> {
    if (!otp || !hash) return false;

    // Check if it's a legacy bcrypt hash (starts with $2a$, $2b$, or $2y$)
    if (hash.startsWith('$2')) {
        return bcrypt.compare(otp, hash);
    }

    // Build ordered list of legitimate OTP HMAC secrets for rotation
    const primary = getOtpHmacSecret();
    const secrets: string[] = [primary];
    const prevSecret = process.env.OTP_HMAC_SECRET_PREVIOUS || process.env.OTP_HMAC_SECRET_OLD;
    if (prevSecret && prevSecret !== primary && prevSecret.length >= 32) {
        secrets.push(prevSecret);
    }

    let hashBuf: Buffer;
    try {
        hashBuf = Buffer.from(hash, 'hex');
    } catch {
        return false;
    }

    for (const secret of secrets) {
        const computedHash = crypto.createHmac('sha256', secret).update(otp).digest('hex');
        const computedBuf = Buffer.from(computedHash, 'hex');
        if (computedBuf.length === hashBuf.length && crypto.timingSafeEqual(computedBuf, hashBuf)) {
            return true;
        }
    }
    return false;
}

/**
 * Calculates expiry timestamp from minutes
 */
export function calculateExpiry(minutes: number): Date {
    const now = new Date();
    return new Date(now.getTime() + minutes * 60 * 1000);
}

export type ExpiryMode = 'time' | 'days' | 'months';

/**
 * Link lifetime: time (minutes), calendar days, or calendar months.
 */
export function calculateExpiryFromMode(mode: ExpiryMode, amount: number): Date {
    if (!Number.isFinite(amount) || amount < 1) {
        throw new Error('Invalid expiry amount');
    }
    const now = new Date();
    if (mode === 'time') {
        return calculateExpiry(amount);
    }
    if (mode === 'days') {
        const d = new Date(now);
        d.setDate(d.getDate() + amount);
        return d;
    }
    const d = new Date(now);
    d.setMonth(d.getMonth() + amount);
    return d;
}

// ============================================
// AES-256-GCM ENCRYPTION UTILITIES
// ============================================

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16; // 128 bits
const AUTH_TAG_LENGTH = 16; // 128 bits
const KEY_LENGTH = 32; // 256 bits

/**
 * Generates a new 256-bit encryption key
 * Store this securely in environment variables
 */
export function generateEncryptionKey(): string {
    return crypto.randomBytes(KEY_LENGTH).toString('hex');
}

// Dynamic key cache that respects process.env changes (essential for testing & rotation)
let _cachedKeyHex: string | null = null;
let _cachedKey: Buffer | null = null;

export function getEncryptionKey(): Buffer {
    const keyHex = process.env.ENCRYPTION_KEY?.trim();
    if (!keyHex) {
        throw new Error('ENCRYPTION_KEY not configured in environment variables');
    }
    if (keyHex.length !== 64 || !/^[0-9a-fA-F]{64}$/.test(keyHex)) {
        throw new Error('ENCRYPTION_KEY must be 64 hex characters (256 bits)');
    }
    if (_cachedKeyHex === keyHex && _cachedKey) {
        return _cachedKey;
    }
    _cachedKeyHex = keyHex;
    _cachedKey = Buffer.from(keyHex, 'hex');
    return _cachedKey;
}

/** Returns candidate encryption keys for decryption (primary key first, then rotated keys). */
function getEncryptionKeysForDecryption(): Buffer[] {
    const primary = getEncryptionKey();
    const candidateBuffers: Buffer[] = [primary];

    const fallbackHexList = [
        process.env.ENCRYPTION_KEY_OLD,
        process.env.ENCRYPTION_KEY_PREVIOUS,
        ...(process.env.ROTATED_ENCRYPTION_KEYS ? process.env.ROTATED_ENCRYPTION_KEYS.split(',') : []),
    ].filter((k): k is string => Boolean(k && k.trim().length === 64 && /^[0-9a-fA-F]{64}$/.test(k.trim())));

    for (const hex of fallbackHexList) {
        const buf = Buffer.from(hex.trim(), 'hex');
        if (!candidateBuffers.some(existing => existing.equals(buf))) {
            candidateBuffers.push(buf);
        }
    }

    return candidateBuffers;
}

let _cachedKekHex: string | null = null;
let _cachedKek: Buffer | null = null;

export function getKekKey(): Buffer {
    const keyHex = process.env.KEK_KEY?.trim();
    if (!keyHex) {
        throw new Error('KEK_KEY not configured in environment variables');
    }
    if (keyHex.length !== 64 || !/^[0-9a-fA-F]{64}$/.test(keyHex)) {
        throw new Error('KEK_KEY must be 64 hex characters (256 bits)');
    }
    if (_cachedKekHex === keyHex && _cachedKek) {
        return _cachedKek;
    }
    _cachedKekHex = keyHex;
    _cachedKek = Buffer.from(keyHex, 'hex');
    return _cachedKek;
}

/** Returns candidate KEK keys for decryption (primary key first, then rotated KEKs). */
function getKekKeysForDecryption(): Buffer[] {
    const primary = getKekKey();
    const candidateBuffers: Buffer[] = [primary];

    const fallbackHexList = [
        process.env.KEK_KEY_OLD,
        process.env.KEK_KEY_PREVIOUS,
        ...(process.env.ROTATED_KEK_KEYS ? process.env.ROTATED_KEK_KEYS.split(',') : []),
    ].filter((k): k is string => Boolean(k && k.trim().length === 64 && /^[0-9a-fA-F]{64}$/.test(k.trim())));

    for (const hex of fallbackHexList) {
        const buf = Buffer.from(hex.trim(), 'hex');
        if (!candidateBuffers.some(existing => existing.equals(buf))) {
            candidateBuffers.push(buf);
        }
    }

    return candidateBuffers;
}

/**
 * Encrypts data using AES-256-GCM
 *
 * Security features:
 * - Unique 96/128-bit IV for each encryption
 * - 128-bit authentication tag (detects tampering)
 * - 256-bit key strength
 *
 * Format: iv:authTag:ciphertext (3 parts, preserving 100% backward compatibility)
 */
export function encryptData(data: object): string {
    const key = getEncryptionKey();
    const iv = crypto.randomBytes(IV_LENGTH);

    const cipher = crypto.createCipheriv(ALGORITHM, key, iv, {
        authTagLength: AUTH_TAG_LENGTH,
    });

    const plaintext = JSON.stringify(data);
    let ciphertext = cipher.update(plaintext, 'utf8', 'hex');
    ciphertext += cipher.final('hex');

    const authTag = cipher.getAuthTag();

    // Format: iv:authTag:ciphertext
    return `${iv.toString('hex')}:${authTag.toString('hex')}:${ciphertext}`;
}

/**
 * Decrypts data encrypted with encryptData.
 * Supports legacy unversioned data (`iv:authTag:ciphertext`), versioned data (`v1:iv:authTag:ciphertext`),
 * and safe key rotation via candidate keys.
 *
 * @param encryptedString - String in format [version:]iv:authTag:ciphertext
 * @returns Decrypted object
 * @throws Error if decryption fails (wrong key, tampered data, invalid format)
 */
export function decryptData<T = object>(encryptedString: string): T {
    if (!encryptedString || typeof encryptedString !== 'string') {
        throw new Error('Invalid encrypted data format');
    }

    const parts = encryptedString.split(':');
    let ivHex: string;
    let authTagHex: string;
    let ciphertext: string;

    if (parts.length === 4 && parts[0].startsWith('v')) {
        // Versioned format: e.g. v1:iv:authTag:ciphertext
        [, ivHex, authTagHex, ciphertext] = parts;
    } else if (parts.length === 3) {
        // Standard legacy format: iv:authTag:ciphertext
        [ivHex, authTagHex, ciphertext] = parts;
    } else {
        throw new Error('Invalid encrypted data format');
    }

    const iv = Buffer.from(ivHex, 'hex');
    const authTag = Buffer.from(authTagHex, 'hex');

    if (iv.length !== IV_LENGTH) {
        throw new Error('Invalid IV length');
    }
    if (authTag.length !== AUTH_TAG_LENGTH) {
        throw new Error('Invalid auth tag length');
    }

    // Safe key rotation strategy: try primary active key first, then rotated keys
    const candidateKeys = getEncryptionKeysForDecryption();
    let lastError: Error | null = null;

    for (const key of candidateKeys) {
        try {
            const decipher = crypto.createDecipheriv(ALGORITHM, key, iv, {
                authTagLength: AUTH_TAG_LENGTH,
            });
            decipher.setAuthTag(authTag);

            let plaintext = decipher.update(ciphertext, 'hex', 'utf8');
            plaintext += decipher.final('utf8');

            return JSON.parse(plaintext) as T;
        } catch (e: any) {
            lastError = e;
            // Wrong key or auth tag failure; try next candidate key in rotation ring
            continue;
        }
    }

    throw lastError || new Error('Failed to decrypt data: Invalid key or tampered data');
}

/**
 * Generates a Data Encryption Key (DEK) for envelope encryption
 * @returns 32-byte secure random Buffer
 */
export function generateDek(): Buffer {
    return crypto.randomBytes(KEY_LENGTH);
}

/**
 * Encrypts a Data Encryption Key using the Master KEK
 * @param dek - The 32-byte Data Encryption Key
 * @returns Encrypted string in format: iv:authTag:ciphertext
 */
export function encryptDek(dek: Buffer): string {
    const key = getKekKey(); // Master KEK
    const iv = crypto.randomBytes(IV_LENGTH);

    const cipher = crypto.createCipheriv(ALGORITHM, key, iv, {
        authTagLength: AUTH_TAG_LENGTH,
    });

    const encryptedContent = Buffer.concat([
        cipher.update(dek),
        cipher.final(),
    ]);

    const authTag = cipher.getAuthTag();

    return `${iv.toString('hex')}:${authTag.toString('hex')}:${encryptedContent.toString('hex')}`;
}

/**
 * Decrypts an encrypted Data Encryption Key string back to the raw key.
 *
 * Supports:
 * 1. Current Master KEK (KEK_KEY)
 * 2. Rotated Master KEKs (KEK_KEY_OLD / KEK_KEY_PREVIOUS)
 * 3. Backwards compatibility: fallback to legacy ENCRYPTION_KEY for DEKs
 *    encrypted before KEK_KEY introduction (symmetric AES-GCM decrypt, not HMAC).
 *
 * @param encryptedDekString - format iv:authTag:ciphertext
 * @returns 32-byte Data Encryption Key
 */
export function decryptDek(encryptedDekString: string): Buffer {
    const parts = encryptedDekString.split(':');
    if (parts.length !== 3) {
        throw new Error('Invalid encrypted DEK format');
    }

    const [ivHex, authTagHex, ciphertextHex] = parts;
    const iv = Buffer.from(ivHex, 'hex');
    const authTag = Buffer.from(authTagHex, 'hex');
    const ciphertext = Buffer.from(ciphertextHex, 'hex');

    if (iv.length !== IV_LENGTH) {
        throw new Error('Invalid IV length for DEK decryption');
    }
    if (authTag.length !== AUTH_TAG_LENGTH) {
        throw new Error('Invalid auth tag length for DEK decryption');
    }

    // Try current KEK and rotated KEKs first
    const candidateKeks = getKekKeysForDecryption();
    for (const key of candidateKeks) {
        try {
            const decipher = crypto.createDecipheriv(ALGORITHM, key, iv, {
                authTagLength: AUTH_TAG_LENGTH,
            });
            decipher.setAuthTag(authTag);

            return Buffer.concat([
                decipher.update(ciphertext),
                decipher.final(),
            ]);
        } catch {
            // Decryption with this candidate KEK failed; try next key in keyring
            continue;
        }
    }

    // Backward-compatibility fallback: legacy ENCRYPTION_KEY for pre-separation DEKs
    try {
        const legacyKey = getEncryptionKey();
        const legacyDecipher = crypto.createDecipheriv(ALGORITHM, legacyKey, iv, {
            authTagLength: AUTH_TAG_LENGTH,
        });
        legacyDecipher.setAuthTag(authTag);

        return Buffer.concat([
            legacyDecipher.update(ciphertext),
            legacyDecipher.final(),
        ]);
    } catch {
        throw new Error('Failed to decrypt DEK: Invalid key or tampered data');
    }
}

/**
 * Encrypts raw binary data (Buffer) for file storage
 * @param buffer - The raw data to encrypt
 * @param dek - Explicit per-file DEK
 */
export function encryptBuffer(buffer: Buffer, dek: Buffer): { iv: string; authTag: string; encryptedContent: Buffer } {
    const iv = crypto.randomBytes(IV_LENGTH);
    const cipher = crypto.createCipheriv(ALGORITHM, dek, iv);

    const encrypted = Buffer.concat([
        cipher.update(buffer),
        cipher.final()
    ]);

    return {
        iv: iv.toString('hex'),
        authTag: cipher.getAuthTag().toString('hex'),
        encryptedContent: encrypted
    };
}

/**
 * Creates an encryption stream for large files to avoid memory exhaustion
 */
export function createEncryptionStream(dek: Buffer) {
    const iv = crypto.randomBytes(IV_LENGTH);
    const cipher = crypto.createCipheriv(ALGORITHM, dek, iv);

    return {
        iv: iv.toString('hex'),
        cipher, // Transform stream
        getAuthTag: () => cipher.getAuthTag().toString('hex')
    };
}

/**
 * Decrypts raw binary data
 * @param encryptedContent - The encrypted buffer
 * @param ivHex - Hex string of the IV
 * @param authTagHex - Hex string of the Auth Tag
 * @param explicitKey - Optional per-file DEK. If omitted, tries candidate encryption keys.
 */
export function decryptBuffer(encryptedContent: Buffer, ivHex: string, authTagHex: string, explicitKey?: Buffer): Buffer {
    const iv = Buffer.from(ivHex, 'hex');
    const authTag = Buffer.from(authTagHex, 'hex');

    if (explicitKey) {
        const decipher = crypto.createDecipheriv(ALGORITHM, explicitKey, iv, {
            authTagLength: AUTH_TAG_LENGTH,
        });
        decipher.setAuthTag(authTag);

        return Buffer.concat([
            decipher.update(encryptedContent),
            decipher.final(),
        ]);
    }

    const candidateKeys = getEncryptionKeysForDecryption();
    let lastErr: Error | null = null;
    for (const key of candidateKeys) {
        try {
            const decipher = crypto.createDecipheriv(ALGORITHM, key, iv, {
                authTagLength: AUTH_TAG_LENGTH,
            });
            decipher.setAuthTag(authTag);

            return Buffer.concat([
                decipher.update(encryptedContent),
                decipher.final(),
            ]);
        } catch (e: any) {
            lastErr = e;
        }
    }

    throw lastErr || new Error('Failed to decrypt buffer: Invalid key or tampered data');
}

/**
 * Generates a SHA-256 hash of data for integrity checking
 * This hash is stored alongside encrypted data to verify integrity
 */
export function generateDataHash(data: object): string {
    const json = JSON.stringify(data);
    return crypto.createHash('sha256').update(json).digest('hex');
}

/**
 * Generates a unique session ID for Redis sessions
 */
export function generateSessionId(): string {
    return crypto.randomBytes(32).toString('hex');
}

/**
 * Generates an owner token for kill switch functionality
 * This is separate from the share token and only given to the data owner
 */
export function generateOwnerToken(): string {
    return crypto.randomBytes(24).toString('base64url');
}
