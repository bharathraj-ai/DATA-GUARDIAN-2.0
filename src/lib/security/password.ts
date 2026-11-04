import * as argon2 from 'argon2';

export { validatePasswordStrength, type PasswordStrengthResult } from './password-strength';

/**
 * Argon2id password hashing options aligned with OWASP recommendations.
 * - Type: Argon2id (hybrid version resistant against side-channel and GPU attacks)
 * - Memory cost: 64 MB (65,536 KiB)
 * - Time cost: 3 iterations
 * - Parallelism: 4 threads
 */
const ARGON2_OPTIONS: argon2.HashOptions = {
    type: argon2.argon2id,
    memoryCost: 65536,
    timeCost: 3,
    parallelism: 4,
};

/**
 * Hash a plaintext password using Argon2id.
 */
export async function hashPassword(password: string): Promise<string> {
    if (!password || typeof password !== 'string') {
        throw new Error('Invalid password provided for hashing');
    }
    const result = await argon2.hash(password, ARGON2_OPTIONS);
    return typeof result === 'string' ? result : (result as Buffer).toString('utf8');
}

/**
 * Timing-safe password verification supporting Argon2id and fallback for legacy bcrypt if needed.
 */
export async function verifyPassword(hash: string | null | undefined, plain: string): Promise<boolean> {
    if (!hash || !plain || typeof hash !== 'string' || typeof plain !== 'string') {
        return false;
    }
    try {
        if (hash.startsWith('$argon2')) {
            return await argon2.verify(hash, plain);
        }
        if (hash.startsWith('$2a$') || hash.startsWith('$2b$') || hash.startsWith('$2y$')) {
            const bcrypt = await import('bcryptjs');
            return await bcrypt.compare(plain, hash);
        }
        return false;
    } catch {
        return false;
    }
}


