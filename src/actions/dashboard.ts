'use server';

import { prisma } from '@/lib/prisma';

export interface DashboardLink {
    id: string;
    token: string;
    ownerToken: string;
    expiresAt: Date;
    isUsed: boolean;
    isRevoked: boolean;
    createdAt: Date;
    allowedVendorEmail: string | null;
    status: 'active' | 'expired' | 'revoked' | 'used';
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
                allowedVendorEmail: true,
            },
        });

        return links.map((link) => ({
            ...link,
            status: getStatus(link),
        }));
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
                allowedVendorEmail: email.toLowerCase(),
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
                allowedVendorEmail: true,
            },
        });

        return links.map((link) => ({
            ...link,
            status: getStatus(link),
        }));
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
