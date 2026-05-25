'use server';

import { prisma } from '@/lib/prisma';
import { decryptData } from '@/lib/crypto';
import { maskEmail, maskPhone } from '@/lib/masking';
import { cookies } from 'next/headers';
import { auth } from '@/lib/auth';
import { cleanupSingleLink } from '@/actions/cleanup';
import { authorizeSecureLink, CapabilityFlags } from '@/lib/linkAuthorization';
import { tryCheckRevoked, tryValidateSession } from '@/lib/redis-helpers';

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
    status: string;
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
    capabilities: CapabilityFlags;
    files: FileMetadata[];
    // Sender & purpose info
    purpose: string | null;
    purposeDetail: string | null;
    ownerName: string | null;
    ownerEmail: string | null;
    isOwner: boolean;
    vendorStatus?: string;
    lastSavedWork?: any;
    resumePoint?: any;
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
        const authResult = await authorizeSecureLink(token, 'view');
        if (!authResult.success) {
            const err = authResult.error.toLowerCase();
            return {
                success: false,
                error: authResult.error,
                errorType: err.includes('revoked') ? 'REVOKED' : err.includes('expired') ? 'EXPIRED' : err.includes('otp') || err.includes('verification') ? 'NOT_VERIFIED' : err.includes('session') ? 'SESSION_INVALID' : 'NOT_FOUND',
            };
        }

        const authSession = await auth(); // Get session for role checks
        const capabilities = authResult.context.capabilities;

        const fullLink = await prisma.secureLink.findUnique({
            where: { token },
            include: {
                UserData: true,
                VendorAccess: true,
                UserFile: {
                    select: {
                        id: true,
                        fileName: true,
                        fileType: true,
                        fileSize: true,
                        status: true,
                    } as any
                },
                User: {
                    select: {
                        name: true,
                        email: true,
                    }
                }
            },
        });

        if (!fullLink || !fullLink.UserData) {
            return {
                success: false,
                error: 'This link is invalid or has been deleted.',
                errorType: 'NOT_FOUND',
            };
        }

        const now = new Date();
        if (fullLink.expiresAt < now) {
            cleanupSingleLink(token).catch(() => { });
            return {
                success: false,
                error: 'This link has expired. All data has been permanently deleted.',
                errorType: 'EXPIRED',
            };
        }

        const remainingMs = fullLink.expiresAt.getTime() - now.getTime();
        const remainingSeconds = Math.max(0, Math.floor(remainingMs / 1000));

        let decryptedData: DecryptedUserData;
        try {
            decryptedData = decryptData<DecryptedUserData>((fullLink as any).UserData.encryptedData);
        } catch (decryptError) {
            console.error('Decryption failed');
            return {
                success: false,
                error: 'Failed to decrypt data. The encryption key may have changed.',
                errorType: 'NOT_FOUND',
            };
        }

        let vendorAccess = null;
        if (authResult.context.effectiveEmail && !authResult.context.isOwner) {
            vendorAccess = (fullLink as any).VendorAccess?.find(
                (v: any) => v.email.toLowerCase() === authResult.context.effectiveEmail!.toLowerCase()
            );
        }

        return {
            success: true,
            data: {
                firstName: decryptedData.firstName,
                lastName: decryptedData.lastName,
                maskedEmail: maskEmail(decryptedData.email),
                maskedPhone: maskPhone(decryptedData.phone),
                gender: decryptedData.gender,
                age: decryptedData.age,
                expiresAt: fullLink.expiresAt,
                remainingSeconds,
                capabilities,
                files: (fullLink as any).UserFile || [],
                purpose: fullLink.purpose,
                purposeDetail: fullLink.purposeDetail,
                ownerName: fullLink.User?.name || null,
                ownerEmail: fullLink.User?.email || null,
                isOwner: authResult.context.isOwner,
                vendorStatus: vendorAccess?.status,
                lastSavedWork: vendorAccess?.lastSavedWork,
                resumePoint: vendorAccess?.resumePoint,
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
        // null = Redis unavailable → fall through to DB check below
        const revokedInRedis = await tryCheckRevoked(token);
        if (revokedInRedis === true) {
            return { success: false, error: 'Revoked' };
        }

        // Validate session if Redis is available
        // null = Redis unavailable → fall through to DB-level auth
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
