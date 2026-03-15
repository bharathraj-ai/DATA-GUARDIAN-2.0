'use server';

import { prisma } from '@/lib/prisma';
import { decryptData } from '@/lib/crypto';
import { maskEmail, maskPhone } from '@/lib/masking';
import { cookies } from 'next/headers';
import { cleanupSingleLink } from '@/actions/cleanup';

// Cache Redis availability check at module load (performance optimization)
const isRedisConfigured = !!(
    process.env.UPSTASH_REDIS_REST_URL &&
    process.env.UPSTASH_REDIS_REST_TOKEN &&
    !process.env.UPSTASH_REDIS_REST_URL.includes('your-redis')
);

// Conditionally check Redis if configured
async function tryValidateSession(token: string, sessionId: string): Promise<boolean | null> {
    if (!isRedisConfigured) return null;

    try {
        const { validateSession } = await import('@/lib/redis');
        return await validateSession(token, sessionId);
    } catch {
        return null;
    }
}

async function tryCheckRevoked(token: string): Promise<boolean | null> {
    if (!isRedisConfigured) return null;

    try {
        const { isTokenRevoked } = await import('@/lib/redis');
        return await isTokenRevoked(token);
    } catch {
        return null;
    }
}

// Decrypted user data type
interface DecryptedUserData {
    firstName: string;
    lastName: string;
    email: string;
    phone: string;
    gender: string;
    age: number;
}

export type FileMetadata = {
    id: string;
    fileName: string;
    fileType: string;
    fileSize: number;
};

export type MaskedUserData = {
    firstName: string;
    lastName: string;
    maskedEmail: string;
    maskedPhone: string;
    gender: string;
    age: number;
    expiresAt: Date;
    remainingSeconds: number;
    allowEditing: boolean;
    files: FileMetadata[];
};

export type GetUserDataResult = {
    success: boolean;
    data?: MaskedUserData;
    error?: string;
    errorType?: 'EXPIRED' | 'NOT_FOUND' | 'NOT_VERIFIED' | 'SESSION_INVALID' | 'REVOKED';
};

/**
 * Gets user data with session validation and decryption
 * 
 * Security features:
 * - Validates Redis session before returning data (if Redis configured)
 * - Checks for kill switch (revocation)
 * - Decrypts data server-side only
 * - Masks sensitive PII in response
 * - Backend-enforced expiry checks
 */
export async function getUserData(token: string): Promise<GetUserDataResult> {
    try {
        // Get session ID from cookie
        const cookieStore = await cookies();
        const sessionId = cookieStore.get('session_id')?.value;

        // Check if token is revoked in Redis (if available)
        const revokedInRedis = await tryCheckRevoked(token);
        if (revokedInRedis === true) {
            return {
                success: false,
                error: 'Access has been revoked by the data owner.',
                errorType: 'REVOKED',
            };
        }

        // Validate session if we have a session ID and Redis is available
        if (sessionId) {
            const isValid = await tryValidateSession(token, sessionId);
            if (isValid === false) {
                return {
                    success: false,
                    error: 'Your session has expired or been invalidated.',
                    errorType: 'SESSION_INVALID',
                };
            }
            // isValid === null means Redis not available, continue with DB-only validation
        }

        // Find the secure link with user data
        const secureLink = await prisma.secureLink.findUnique({
            where: { token },
            include: {
                UserData: true,
                UserFile: {
                    select: {
                        id: true,
                        fileName: true,
                        fileType: true,
                        fileSize: true,
                    }
                }
            },
        });

        // Link not found
        if (!secureLink || !secureLink.UserData) {
            return {
                success: false,
                error: 'This link is invalid or has been deleted.',
                errorType: 'NOT_FOUND',
            };
        }

        // Check if link is revoked in DB (backup check)
        if (secureLink.isRevoked) {
            return {
                success: false,
                error: 'Access has been revoked by the data owner.',
                errorType: 'REVOKED',
            };
        }

        // Check if link was verified (must be used to view data)
        if (!secureLink.isUsed) {
            return {
                success: false,
                error: 'Please verify with OTP first.',
                errorType: 'NOT_VERIFIED',
            };
        }

        // Check if link is expired (backend enforcement - Zero Trust)
        const now = new Date();
        if (secureLink.expiresAt < now) {
            // AUTO-CLEANUP: Delete all data when expired
            cleanupSingleLink(token).catch(() => { });
            return {
                success: false,
                error: 'This link has expired. All data has been permanently deleted.',
                errorType: 'EXPIRED',
            };
        }

        // Calculate remaining time
        const remainingMs = secureLink.expiresAt.getTime() - now.getTime();
        const remainingSeconds = Math.max(0, Math.floor(remainingMs / 1000));

        // Decrypt user data
        let decryptedData: DecryptedUserData;
        try {
            decryptedData = decryptData<DecryptedUserData>(secureLink.UserData.encryptedData);
        } catch (decryptError) {
            console.error('Decryption failed');
            return {
                success: false,
                error: 'Failed to decrypt data. The encryption key may have changed.',
                errorType: 'NOT_FOUND',
            };
        }

        // Return masked user data (never expose full PII to frontend)
        return {
            success: true,
            data: {
                firstName: decryptedData.firstName,
                lastName: decryptedData.lastName,
                maskedEmail: maskEmail(decryptedData.email),
                maskedPhone: maskPhone(decryptedData.phone),
                gender: decryptedData.gender,
                age: decryptedData.age,
                expiresAt: secureLink.expiresAt,
                remainingSeconds,
                allowEditing: secureLink.allowEditing,
                files: secureLink.UserFile || [],
            },
        };
    } catch (error) {
        console.error('Error getting user data:', error instanceof Error ? error.message : 'Unknown');
        return {
            success: false,
            error: 'Failed to retrieve data. Please try again.',
        };
    }
}

/**
 * Gets full (unmasked) user data - use with caution
 * This should only be used for SSE streaming with proper session validation
 */
export async function getFullUserData(token: string, sessionId: string): Promise<{
    success: boolean;
    data?: DecryptedUserData;
    expiresAt?: Date;
    remainingSeconds?: number;
    error?: string;
}> {
    try {
        // Check revocation in Redis if available
        const revokedInRedis = await tryCheckRevoked(token);
        if (revokedInRedis === true) {
            return { success: false, error: 'Revoked' };
        }

        // Validate session if Redis is available
        const isValid = await tryValidateSession(token, sessionId);
        if (isValid === false) {
            return { success: false, error: 'Invalid session' };
        }

        // Get and decrypt data
        const secureLink = await prisma.secureLink.findUnique({
            where: { token },
            include: { UserData: true },
        });

        if (!secureLink || !secureLink.UserData || !secureLink.isUsed || secureLink.isRevoked) {
            return { success: false, error: 'Not accessible' };
        }

        const now = new Date();
        if (secureLink.expiresAt < now) {
            return { success: false, error: 'Expired' };
        }

        const remainingMs = secureLink.expiresAt.getTime() - now.getTime();
        const remainingSeconds = Math.max(0, Math.floor(remainingMs / 1000));

        const decryptedData = decryptData<DecryptedUserData>(secureLink.UserData.encryptedData);

        return {
            success: true,
            data: decryptedData,
            expiresAt: secureLink.expiresAt,
            remainingSeconds,
        };
    } catch {
        return { success: false, error: 'Failed to get data' };
    }
}
