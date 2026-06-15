'use server';

import { prisma } from '@/lib/prisma';
import { cleanupExpiredData } from '@/actions/cleanup';
import { auth } from '@/lib/auth';

export interface DashboardLink {
    id: string;
    token: string;
    ownerToken?: string;
    expiresAt: Date;
    isUsed: boolean;
    isRevoked: boolean;
    createdAt: Date;
    allowedVendorEmail: string | null;
    vendorAccess: { email: string; level: number; status?: string }[];
    status: 'active' | 'expired' | 'revoked' | 'used' | 'break';
    /** Legacy field — OTPs are never persisted; always null. */
    otp: null;
    // Enhanced fields
    purpose: string | null;
    purposeDetail: string | null;
    notificationEmail: string | null;
    failedAttempts: number;
    lockedAt: Date | null;
    otpVerifiedAt: Date | null;
    fileCount: number;
    vendors: { vendorEmail: string; level: number }[];
    files: { id: string; fileName: string; fileSize: number; fileType: string; status: string }[];
    auditLogs: { action: string; timestamp: Date; reason: string | null }[];
}

/**
 * Shared mapper: converts a raw Prisma link into a DashboardLink.
 */
function mapLinkToBase(link: any, effectiveIsUsed: boolean): DashboardLink {
    const primaryVendor = link.LinkAccess?.[0]?.vendorEmail || link.allowedVendorEmail || null;
    return {
        ...link,
        allowedVendorEmail: primaryVendor,
        vendorAccess: link.VendorAccess || [],
        vendors: link.LinkAccess || [],
        files: link.UserFile,
        auditLogs: link.AuditLog,
        status: getStatus({ ...link, isUsed: effectiveIsUsed }),
        fileCount: link.UserFile.length,
        otp: null,
    } as DashboardLink;
}

/**
 * Get links created by the user (as owner)
 */
export async function getOwnedLinks(userId: string): Promise<DashboardLink[]> {
    try {
        // SECURITY: Verify the caller IS this userId — prevent parameter tampering
        const session = await auth();
        if (!session?.user?.id || session.user.id !== userId) {
            console.error('[SECURITY] getOwnedLinks called with mismatched userId');
            return [];
        }
        const links = await prisma.secureLink.findMany({
            where: {
                ownerId: userId,
            },
            orderBy: {
                createdAt: 'desc',
            },
            select: {
                id: true,
                token: true,
                ownerToken: true,
                expiresAt: true,
                isUsed: true,
                isRevoked: true,
                createdAt: true,
                purpose: true,
                purposeDetail: true,
                notificationEmail: true,
                failedAttempts: true,
                lockedAt: true,
                otpVerifiedAt: true,
                LinkAccess: {
                    select: {
                        vendorEmail: true,
                        level: true,
                        isUsed: true,
                    }
                },
                VendorAccess: {
                    select: {
                        email: true,
                        level: true,
                        status: true,
                    },
                    orderBy: {
                        level: 'asc',
                    },
                },
                UserFile: {
                    select: {
                        id: true,
                        fileName: true,
                        fileSize: true,
                        fileType: true,
                        status: true,
                    } as any,
                },
                AuditLog: {
                    select: {
                        action: true,
                        timestamp: true,
                        reason: true,
                    },
                    orderBy: {
                        timestamp: 'desc',
                    },
                    take: 10,
                },
            },
        });

        const mappedLinks = (links as any[]).map((link: any) => {
            const anyVendorUsed = link.LinkAccess?.some((a: any) => a.isUsed) || false;
            return mapLinkToBase(link, link.isUsed || anyVendorUsed);
        });

        // AUTO-CLEANUP: If any expired/revoked links exist, trigger background purge
        const hasExpiredData = mappedLinks.some(l => l.status === 'expired' || l.status === 'revoked');
        if (hasExpiredData) {
            cleanupExpiredData().catch(() => { /* non-blocking */ });
        }

        return mappedLinks;
    } catch (error) {
        console.error('Error fetching owned links:', error);
        return [];
    }
}

/**
 * Get links shared with the user (as vendor/receiver)
 */
export async function getReceivedLinks(email: string): Promise<DashboardLink[]> {
    try {
        // SECURITY: Verify the caller owns this email — prevent parameter tampering
        const session = await auth();
        if (!session?.user?.email || session.user.email.toLowerCase() !== email.toLowerCase()) {
            console.error('[SECURITY] getReceivedLinks called with mismatched email');
            return [];
        }
        const links = await prisma.secureLink.findMany({
            where: {
                OR: [
                    { allowedVendorEmail: email.toLowerCase() },
                    { VendorAccess: { some: { email: email.toLowerCase() } } },
                    { LinkAccess: { some: { vendorEmail: email.toLowerCase() } } }
                ],
            },
            orderBy: {
                createdAt: 'desc',
            },
            select: {
                id: true,
                token: true,
                expiresAt: true,
                isUsed: true,
                isRevoked: true,
                createdAt: true,
                purpose: true,
                purposeDetail: true,
                notificationEmail: true,
                failedAttempts: true,
                lockedAt: true,
                otpVerifiedAt: true,
                LinkAccess: {
                    select: {
                        vendorEmail: true,
                        level: true,
                        isUsed: true,
                    }
                },
                VendorAccess: {
                    select: {
                        email: true,
                        level: true,
                        status: true,
                    },
                    orderBy: {
                        level: 'asc',
                    },
                },
                UserFile: {
                    select: {
                        id: true,
                        fileName: true,
                        fileSize: true,
                        fileType: true,
                        status: true,
                    } as any,
                },
                AuditLog: {
                    select: {
                        action: true,
                        timestamp: true,
                        reason: true,
                    },
                    orderBy: {
                        timestamp: 'desc',
                    },
                    take: 10,
                },
            },
        });

        const mappedLinks = (links as any[]).map((link: any) => {
            // For the vendor, the link is "Used" ONLY if THEIR specific LinkAccess record is marked as used.
            const vendorIsUsed = link.LinkAccess?.[0]?.isUsed ?? link.isUsed;
            const mapped = mapLinkToBase(link, vendorIsUsed);

            const vendorAccessRecord = link.VendorAccess?.find((v: any) => v.email.toLowerCase() === email.toLowerCase());
            
            // If vendor has accessed but NOT completed work, let them resume
            if (mapped.status === 'used' && vendorAccessRecord?.status && vendorAccessRecord.status !== 'completed') {
                (mapped as any).status = 'break';
            }

            return mapped;
        });

        // AUTO-CLEANUP: If any expired/revoked links exist, trigger background purge
        const hasExpiredData = mappedLinks.some(l => l.status === 'expired' || l.status === 'revoked');
        if (hasExpiredData) {
            cleanupExpiredData().catch(() => { /* non-blocking */ });
        }

        return mappedLinks;
    } catch (error) {
        console.error('Error fetching received links:', error);
        return [];
    }
}

function getStatus(link: { expiresAt: Date; isUsed: boolean; isRevoked: boolean }): 'active' | 'expired' | 'revoked' | 'used' {
    if (link.isRevoked) return 'revoked';
    if (link.isUsed) return 'used';
    if (new Date() > link.expiresAt) return 'expired';
    return 'active';
}

/**
 * Send history record — survives data deletion.
 * Shows WHO was sent data and WHAT topic, even after the actual data is purged.
 */
export interface SendHistoryRecord {
    id: string;
    topic: string;
    vendorEmail: string | null;
    fileCount: number;
    status: string;         // active | expired | revoked | cleaned
    createdAt: Date;
    expiredAt: Date | null;
}

/**
 * Get the owner's complete send history.
 * These records survive data deletion — the owner always knows
 * WHO they sent data to and WHAT it was about.
 */
export async function getSendHistory(userId: string): Promise<SendHistoryRecord[]> {
    try {
        // SECURITY: Verify the caller IS this userId — prevent parameter tampering
        const session = await auth();
        if (!session?.user?.id || session.user.id !== userId) {
            console.error('[SECURITY] getSendHistory called with mismatched userId');
            return [];
        }
        const records = await prisma.sendRecord.findMany({
            where: { ownerId: userId },
            orderBy: { createdAt: 'desc' },
            select: {
                id: true,
                topic: true,
                vendorEmail: true,
                fileCount: true,
                status: true,
                createdAt: true,
                expiredAt: true,
            },
        });

        return records;
    } catch (error) {
        console.error('Error fetching send history:', error);
        return [];
    }
}
