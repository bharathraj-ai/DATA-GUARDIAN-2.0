'use server';

import { prisma } from '@/lib/prisma';

export interface VendorOption {
    email: string;
    name: string | null;
}

/**
 * Fetch all available vendors (users with VENDOR role) from the database.
 * Used in the Create Secure Link page to populate the vendor email dropdown.
 */
export async function getAvailableVendors(): Promise<VendorOption[]> {
    try {
        const vendors = await prisma.user.findMany({
            where: {
                role: 'VENDOR',
            },
            select: {
                email: true,
                name: true,
            },
            orderBy: {
                name: 'asc',
            },
        });

        return vendors;
    } catch (error) {
        console.error('Error fetching vendors:', error);
        return [];
    }
}
