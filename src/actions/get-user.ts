'use server';

import { prisma } from '@/lib/prisma';
import { decryptData } from '@/lib/crypto';
import { maskEmail, maskPhone } from '@/lib/masking';
import { cookies } from 'next/headers';
import { executeSingleLinkCleanup } from '@/lib/cleanup-core';
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

        const capabilities = authResult.context.capabilities;
        const secureLink = authResult.context.secureLink;

        // Only fetch UserData — the auth result already includes VendorAccess, UserFile, User
        const userData = await prisma.userData.findUnique({
            where: { id: secureLink.userId },
        });

        if (!userData) {
            return {
                success: false,
                error: 'This link is invalid or has been deleted.',
                errorType: 'NOT_FOUND',
            };
        }

        const now = new Date();
        if (secureLink.expiresAt < now || secureLink.isRevoked) {
            await executeSingleLinkCleanup(token).catch(() => {});
            return {
                success: false,
                error: secureLink.isRevoked
                    ? 'This link has been revoked. All data has been permanently deleted.'
                    : 'This link has expired. All data has been permanently deleted.',
                errorType: secureLink.isRevoked ? 'REVOKED' : 'EXPIRED',
            };
        }

        const remainingMs = secureLink.expiresAt.getTime() - now.getTime();
        const remainingSeconds = Math.max(0, Math.floor(remainingMs / 1000));

        let decryptedData: DecryptedUserData;
        try {
            decryptedData = decryptData<DecryptedUserData>((userData as any).encryptedData);
        } catch (decryptError) {
            console.error('Decryption failed');
            return {
                success: false,
                error: 'Failed to decrypt data. The encryption key may have changed.',
                errorType: 'NOT_FOUND',
            };
        }

        let vendorAccess = null as {
            status?: string;
            lastSavedWork?: unknown;
            resumePoint?: unknown;
        } | null;

        if (authResult.context.effectiveEmail && !authResult.context.isOwner) {
            const email = authResult.context.effectiveEmail.toLowerCase();
            const vendors = (secureLink as { VendorAccess?: Array<{
                email: string;
                status?: string;
                lastSavedWork?: unknown;
                resumePoint?: unknown;
            }> }).VendorAccess || [];
            vendorAccess = vendors.find((v) => v.email.toLowerCase() === email) ?? null;
        }

        // Derive owner info from the User relation already loaded by authorizeSecureLink
        const ownerUser = (secureLink as any).User;

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
                capabilities,
                files: (secureLink as any).UserFile || [],
                purpose: secureLink.purpose,
                purposeDetail: secureLink.purposeDetail,
                ownerName: ownerUser?.name ?? null,
                ownerEmail: ownerUser?.email || null,
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
 * Gets full (unmasked) user data — cookie-bound signed session + DB.
 * Redis is an optional cache only.
 */
export async function getFullUserData(token: string): Promise<{
    success: boolean;
    data?: DecryptedUserData;
    expiresAt?: Date;
    remainingSeconds?: number;
    error?: string;
}> {
    try {
        const { cookies } = await import('next/headers');
        const { verifyShareSession } = await import('@/lib/share-session');
        const cookieStore = await cookies();
        const verified = verifyShareSession(cookieStore.get('session_id')?.value, token);
        if (!verified.valid) {
            return { success: false, error: 'Unauthorized' };
        }

        const revokedInRedis = await tryCheckRevoked(token);
        if (revokedInRedis === true) {
            return { success: false, error: 'Revoked' };
        }

        const isValid = await tryValidateSession(token, verified.sessionId);
        if (isValid === false) {
            return { success: false, error: 'Invalid session' };
        }

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
