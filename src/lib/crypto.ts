import { v4 as uuidv4 } from 'uuid';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';

// ============================================
// TOKEN & OTP UTILITIES
// ============================================

/**
 * Generates a cryptographically secure token using UUID v4
 */
export function generateSecureToken(): string {
    return uuidv4();
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
 * Hashes an OTP using HMAC-SHA256 (fast, secure for short-lived tokens)
 * 
 * For 6-digit OTPs with 5-minute expiry and 3-attempt limit, HMAC is more appropriate
 * than bcrypt because:
 * - OTPs are short-lived (brute-force window is minimal)
 * - We need fast verification for good UX
 * - HMAC with a secret key provides sufficient security
 */
export async function hashOTP(otp: string): Promise<string> {
    const secret = process.env.ENCRYPTION_KEY;
    if (!secret) {
        throw new Error('ENCRYPTION_KEY environment variable is required for OTP hashing');
    }
    return crypto.createHmac('sha256', secret).update(otp).digest('hex');
}

/**
 * Verifies an OTP against its hash
 * Supports both new HMAC hashes and legacy bcrypt hashes for backward compatibility
 */
export async function verifyOTPHash(otp: string, hash: string): Promise<boolean> {
    // Check if it's a bcrypt hash (starts with $2a$, $2b$, or $2y$)
    if (hash.startsWith('$2')) {
        // Legacy bcrypt verification for existing OTPs
        return bcrypt.compare(otp, hash);
    }

    // Fast HMAC verification for new OTPs
    const secret = process.env.ENCRYPTION_KEY;
    if (!secret) {
        throw new Error('ENCRYPTION_KEY environment variable is required for OTP verification');
    }
    const computedHash = crypto.createHmac('sha256', secret).update(otp).digest('hex');

    // Constant-time comparison to prevent timing attacks
    return crypto.timingSafeEqual(Buffer.from(computedHash), Buffer.from(hash));
}

/**
 * Calculates expiry timestamp from minutes
 */
export function calculateExpiry(minutes: number): Date {
    const now = new Date();
    return new Date(now.getTime() + minutes * 60 * 1000);
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

// Cache the encryption key to avoid repeated env parsing
let _cachedKey: Buffer | null = null;

function getEncryptionKey(): Buffer {
    if (_cachedKey) return _cachedKey;

    const keyHex = process.env.ENCRYPTION_KEY;
    if (!keyHex) {
        throw new Error('ENCRYPTION_KEY not configured in environment variables');
    }
    if (keyHex.length !== 64) {
        throw new Error('ENCRYPTION_KEY must be 64 hex characters (256 bits)');
    }
    _cachedKey = Buffer.from(keyHex, 'hex');
    return _cachedKey;
}

/**
 * Encrypts data using AES-256-GCM
 * 
 * Security features:
 * - Unique IV for each encryption (no pattern leakage)
 * - Authentication tag (detects tampering)
 * - 256-bit key strength
 * 
 * @param data - Object to encrypt
 * @returns Encrypted string in format: iv:authTag:ciphertext (all hex encoded)
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
 * Decrypts data encrypted with encryptData
 * 
 * @param encryptedString - String in format iv:authTag:ciphertext
 * @returns Decrypted object
 * @throws Error if decryption fails (wrong key, tampered data, etc.)
 */
export function decryptData<T = object>(encryptedString: string): T {
    const key = getEncryptionKey();

    const parts = encryptedString.split(':');
    if (parts.length !== 3) {
        throw new Error('Invalid encrypted data format');
    }

    const [ivHex, authTagHex, ciphertext] = parts;
    const iv = Buffer.from(ivHex, 'hex');
    const authTag = Buffer.from(authTagHex, 'hex');

    if (iv.length !== IV_LENGTH) {
        throw new Error('Invalid IV length');
    }
    if (authTag.length !== AUTH_TAG_LENGTH) {
        throw new Error('Invalid auth tag length');
    }

    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv, {
        authTagLength: AUTH_TAG_LENGTH,
    });
    decipher.setAuthTag(authTag);

    let plaintext = decipher.update(ciphertext, 'hex', 'utf8');
    plaintext += decipher.final('utf8');

    return JSON.parse(plaintext) as T;
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
    const key = getEncryptionKey(); // Master KEK
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
 * Decrypts an encrypted Data Encryption Key string back to the raw key
 * @param encryptedDekString - format iv:authTag:ciphertext
 * @returns 32-byte Data Encryption Key
 */
export function decryptDek(encryptedDekString: string): Buffer {
    const key = getEncryptionKey(); // Master KEK

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

    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv, {
        authTagLength: AUTH_TAG_LENGTH,
    });
    decipher.setAuthTag(authTag);

    return Buffer.concat([
        decipher.update(ciphertext),
        decipher.final(),
    ]);
}

/**
 * Encrypts raw binary data (Buffer) for file storage
 * @param buffer - The raw data to encrypt
 * @param explicitKey - Optional per-file DEK. If omitted, falls back to Master KEK (for backwards compatibility).
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
        cipher, // This is a Transform stream
        getAuthTag: () => cipher.getAuthTag().toString('hex')
    };
}

/**
 * Decrypts raw binary data
 * @param encryptedContent - The encrypted buffer
 * @param ivHex - Hex string of the IV
 * @param authTagHex - Hex string of the Auth Tag
 * @param explicitKey - Optional per-file DEK. If omitted, falls back to Master KEK (for backwards compatibility).
 */
export function decryptBuffer(encryptedContent: Buffer, ivHex: string, authTagHex: string, explicitKey?: Buffer): Buffer {
    const key = explicitKey || getEncryptionKey();
    const iv = Buffer.from(ivHex, 'hex');
    const authTag = Buffer.from(authTagHex, 'hex');

    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv, {
        authTagLength: AUTH_TAG_LENGTH,
    });
    decipher.setAuthTag(authTag);

    return Buffer.concat([
        decipher.update(encryptedContent),
        decipher.final(),
    ]);
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
