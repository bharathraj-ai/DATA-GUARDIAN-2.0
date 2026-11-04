import * as bcrypt from 'bcryptjs';

export { validatePasswordStrength, type PasswordStrengthResult } from './password-strength';

/**
 * Bcrypt salt rounds aligned with OWASP recommendations.
 * Cost factor of 12 provides good security-performance balance.
 */
const BCRYPT_ROUNDS = 12;

/**
 * Hash a plaintext password using bcrypt.
 */
export async function hashPassword(password: string): Promise<string> {
    if (!password || typeof password !== 'string') {
        throw new Error('Invalid password provided for hashing');
    }
    return await bcrypt.hash(password, BCRYPT_ROUNDS);
}

/**
 * Timing-safe password verification for bcrypt hashes.
 */
export async function verifyPassword(hash: string | null | undefined, plain: string): Promise<boolean> {
    if (!hash || !plain || typeof hash !== 'string' || typeof plain !== 'string') {
        return false;
    }
    try {
        // Support bcrypt format
        if (hash.startsWith('$2a$') || hash.startsWith('$2b$') || hash.startsWith('$2y$')) {
            return await bcrypt.compare(plain, hash);
        }
        return false;
    } catch {
        return false;
    }
}


