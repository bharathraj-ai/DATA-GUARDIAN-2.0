'use server';

import { prisma } from '@/lib/prisma';
import { decryptData } from '@/lib/crypto';
import { maskEmail, maskPhone } from '@/lib/masking';
import { executeSingleLinkCleanup } from '@/lib/cleanup-core';
import { authorizeSecureLink, CapabilityFlags } from '@/lib/linkAuthorization';
import { logger } from '@/lib/logger';

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
    myAssignedLevel: number;
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
    allowedBreaks?: number;
    breaksUsed?: number;
};

export type GetUserDataResult = {
    success: boolean;
    data?: MaskedUserData;
    error?: string;
    errorType?: 'EXPIRED' | 'NOT_FOUND' | 'NOT_VERIFIED' | 'SESSION_INVALID' | 'REVOKED' | 'COMPLETED';
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
        const authResult = await authorizeSecureLink(token, 'view', undefined, {
            includeDraft: true,
            includeUserData: true,
        });
        if (!authResult.success) {
            try {
                const linkStatus = await prisma.secureLink.findUnique({
                    where: { token },
                    select: {
                        isRevoked: true,
                        VendorAccess: {
                            select: { status: true },
                        },
                        AuditLog: {
                            where: { action: 'VENDOR_COMPLETED_WORK' },
                            take: 1,
                            select: { id: true },
                        },
                    },
                });

                const isCompleted =
                    linkStatus?.VendorAccess.some((v) => v.status === 'completed') ||
                    (linkStatus?.AuditLog && linkStatus.AuditLog.length > 0);

                if (isCompleted) {
                    return {
                        success: false,
                        error: 'This assignment has been completed and all files were delivered to the owner.',
                        errorType: 'COMPLETED',
                    };
                }
            } catch {
                /* fall back to normal error mapping */
            }

            const err = authResult.error.toLowerCase();
            return {
                success: false,
                error: authResult.error,
                errorType: err.includes('revoked') ? 'REVOKED' : err.includes('expired') ? 'EXPIRED' : err.includes('otp') || err.includes('verification') ? 'NOT_VERIFIED' : err.includes('session') ? 'SESSION_INVALID' : 'NOT_FOUND',
            };
        }

        const capabilities = authResult.context.capabilities;
        const secureLink = authResult.context.secureLink;
        const encryptedData = (secureLink as { UserData?: { encryptedData: string } | null }).UserData?.encryptedData;

        if (!encryptedData) {
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
            decryptedData = decryptData<DecryptedUserData>(encryptedData);
        } catch (decErr) {
            logger.error('Decryption failed', decErr);
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
            allowedBreaks?: number | null;
            breaksUsed?: number | null;
        } | null;

        if (authResult.context.effectiveEmail && !authResult.context.isOwner) {
            const email = authResult.context.effectiveEmail.toLowerCase();
            const vendors = (secureLink as { VendorAccess?: Array<{
                email: string;
                status?: string;
                lastSavedWork?: unknown;
                resumePoint?: unknown;
                allowedBreaks?: number | null;
                breaksUsed?: number | null;
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
                myAssignedLevel: authResult.context.isOwner
                    ? 1
                    : (authResult.context.vendorAccess?.level ?? 2),
                files: (secureLink as any).UserFile || [],
                purpose: secureLink.purpose,
                purposeDetail: secureLink.purposeDetail,
                ownerName: ownerUser?.name ?? null,
                ownerEmail: ownerUser?.email || null,
                isOwner: authResult.context.isOwner,
                vendorStatus: vendorAccess?.status,
                lastSavedWork: vendorAccess?.lastSavedWork,
                resumePoint: vendorAccess?.resumePoint,
                allowedBreaks: vendorAccess?.allowedBreaks ?? 0,
                breaksUsed: vendorAccess?.breaksUsed ?? 0,
            },
        };
    } catch (error) {
        logger.error('Error getting user data:', error);
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
        const authResult = await authorizeSecureLink(token, 'view', undefined, {
            includeDraft: false,
            includeUserData: true,
        });
        if (!authResult.success || !authResult.context.isOwner) {
            return { success: false, error: 'Unauthorized' };
        }

        const secureLink = authResult.context.secureLink;
        const encryptedData = (secureLink as { UserData?: { encryptedData: string } | null }).UserData?.encryptedData;

        if (!encryptedData || !secureLink.isUsed) {
            return { success: false, error: 'Not accessible' };
        }

        const remainingMs = secureLink.expiresAt.getTime() - Date.now();
        const remainingSeconds = Math.max(0, Math.floor(remainingMs / 1000));
        const decryptedData = decryptData<DecryptedUserData>(encryptedData);

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
