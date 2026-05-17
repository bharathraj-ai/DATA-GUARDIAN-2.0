'use server';

import { prisma } from '@/lib/prisma';
import { auth } from '@/lib/auth';

export interface VendorOption {
    email: string;
    name: string | null;
}

/**
 * Fetch all available vendors (users with VENDOR role) from the database.
 * Used in the Create Secure Link page to populate the vendor email dropdown.
 * 
 * SECURITY: Requires authentication — vendor emails are PII.
 */
export async function getAvailableVendors(): Promise<VendorOption[]> {
    try {
        // SECURITY: Only authenticated users can see vendor list
        const session = await auth();
        if (!session?.user?.id) {
            return [];
        }
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
