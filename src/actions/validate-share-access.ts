'use server';

import { prisma } from '@/lib/prisma';
import { auth } from '@/lib/auth';
import { executeSingleLinkCleanup } from '@/lib/cleanup-core';

export type ValidateShareAccessResult = {
    allowed: boolean;
    requiresAuth: boolean;
    error?: string;
    errorType?: 'NOT_FOUND' | 'EXPIRED' | 'REVOKED' | 'LOCKED' | 'NOT_AUTHENTICATED' | 'EMAIL_MISMATCH';
};

/**
 * Validates whether the current user is authorized to access a share link.
 * 
 * Security rules:
 * 1. Link must exist and not be revoked/expired/locked
 * 2. If the link has allowedVendorEmail, user MUST be authenticated
 * 3. Authenticated user's email MUST match allowedVendorEmail
 * 4. Without allowedVendorEmail, link is open to anyone with OTP (legacy behavior)
 */
export async function validateShareAccess(token: string): Promise<ValidateShareAccessResult> {
    try {
        // Find the secure link
        const secureLink = await prisma.secureLink.findUnique({
            where: { token },
            select: {
                id: true,
                isRevoked: true,
                expiresAt: true,
                lockedAt: true,
                failedAttempts: true,
                LinkAccess: {
                    select: {
                        vendorEmail: true,
                    }
                },
            },
        });

        if (!secureLink) {
            return {
                allowed: false,
                requiresAuth: false,
                error: 'This link is invalid or has been deleted.',
                errorType: 'NOT_FOUND',
            };
        }

        // Check if link is locked
        if (secureLink.lockedAt || secureLink.failedAttempts >= 3) {
            return {
                allowed: false,
                requiresAuth: false,
                error: 'This link has been permanently locked due to a security violation.',
                errorType: 'LOCKED',
            };
        }

        // Check if link is revoked
        if (secureLink.isRevoked) {
            return {
                allowed: false,
                requiresAuth: false,
                error: 'This link has been revoked by the owner.',
                errorType: 'REVOKED',
            };
        }

        // Check if link is expired
        const now = new Date();
        if (secureLink.expiresAt < now) {
            // AUTO-CLEANUP: Delete all data when expired
            executeSingleLinkCleanup(token).catch(() => { });
            return {
                allowed: false,
                requiresAuth: false,
                error: 'This link has expired. All data has been permanently deleted.',
                errorType: 'EXPIRED',
            };
        }

        // SECURITY: If link has an allowed vendor email, enforce authentication
        if (secureLink.LinkAccess && secureLink.LinkAccess.length > 0) {
            const session = await auth();
            const userEmail = session?.user?.email;

            if (!userEmail) {
                return {
                    allowed: false,
                    requiresAuth: true,
                    error: 'You must sign in with Google to access this secure link.',
                    errorType: 'NOT_AUTHENTICATED',
                };
            }

            const isAllowed = secureLink.LinkAccess.some(
                access => access.vendorEmail.toLowerCase() === userEmail.toLowerCase()
            );

            if (!isAllowed) {
                // Log the unauthorized access attempt
                await prisma.auditLog.create({
                    data: {
                        action: 'DENIED',
                        linkId: secureLink.id,
                        reason: 'Share page access denied - email mismatch',
                        metadata: JSON.stringify({
                            type: 'share_page_email_mismatch',
                            attemptedEmail: userEmail.substring(0, 3) + '***',
                        }),
                    },
                });

                return {
                    allowed: false,
                    requiresAuth: false,
                    error: 'This secure link was shared with a different recipient. You are not authorized to access it.',
                    errorType: 'EMAIL_MISMATCH',
                };
            }
        }

        // All checks passed
        return { allowed: true, requiresAuth: false };
    } catch (error) {
        console.error('Error validating share access:', error instanceof Error ? error.message : 'Unknown');
        return {
            allowed: false,
            requiresAuth: false,
            error: 'Failed to validate access. Please try again.',
        };
    }
}
