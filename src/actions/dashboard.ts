'use server';

import { prisma } from '@/lib/prisma';
import { cleanupExpiredData } from '@/actions/cleanup';

export interface DashboardLink {
    id: string;
    token: string;
    ownerToken: string;
    expiresAt: Date;
    isUsed: boolean;
    isRevoked: boolean;
    createdAt: Date;
    allowedVendorEmail: string | null;
    vendorAccess: { email: string; level: number }[];
    status: 'active' | 'expired' | 'revoked' | 'used';
    otp: string | null;
    // Enhanced fields
    purpose: string | null;
    purposeDetail: string | null;
    notificationEmail: string | null;
    failedAttempts: number;
    lockedAt: Date | null;
    otpVerifiedAt: Date | null;
    fileCount: number;
    vendors: { vendorEmail: string; level: number }[];
    files: { id: string; fileName: string; fileSize: number; fileType: string }[];
    auditLogs: { action: string; timestamp: Date; reason: string | null }[];
}

/**
 * Get links created by the user (as owner)
 */
export async function getOwnedLinks(userId: string): Promise<DashboardLink[]> {
    try {
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
                otpPlain: true,
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
                    },
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

        const mappedLinks = links.map((link) => {
            const primaryVendor = link.LinkAccess?.[0]?.vendorEmail || (link as any).allowedVendorEmail || null;
            
            // For the owner, the link is "Used" if any vendor has viewed it, or if it was globally used.
            const anyVendorUsed = link.LinkAccess?.some(a => a.isUsed) || false;
            const effectiveIsUsed = link.isUsed || anyVendorUsed;

            return {
                ...link,
                allowedVendorEmail: primaryVendor,
                vendorAccess: link.VendorAccess || [],
                vendors: link.LinkAccess || [],
                files: link.UserFile,
                auditLogs: link.AuditLog,
                status: getStatus({ ...link, isUsed: effectiveIsUsed }),
                fileCount: link.UserFile.length,
                otp: link.otpPlain,
            };
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
                otpPlain: true,
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
                    },
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

        const mappedLinks = links.map((link) => {
            const primaryVendor = link.LinkAccess?.[0]?.vendorEmail || (link as any).allowedVendorEmail || null;
            
            // For the vendor, the link is "Used" ONLY if THEIR specific LinkAccess record is marked as used.
            // (Since the query filters by their email, LinkAccess[0] is guaranteed to be theirs if it exists).
            const vendorIsUsed = link.LinkAccess?.[0]?.isUsed ?? link.isUsed;

            return {
                ...link,
                allowedVendorEmail: primaryVendor,
                vendors: link.LinkAccess || [],
                vendorAccess: link.VendorAccess || [],
                files: link.UserFile,
                auditLogs: link.AuditLog,
                status: getStatus({ ...link, isUsed: vendorIsUsed }),
                fileCount: link.UserFile.length,
                otp: link.otpPlain,
            };
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
