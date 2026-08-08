'use server';

import { prisma } from '@/lib/prisma';
import { auth } from '@/lib/auth';

export interface VendorOption {
    email: string;
    name: string | null;
}

/**
 * Fetch vendors for the Create Secure Link dropdown.
 * OWNER-only — prevents any logged-in vendor from enumerating all vendor emails.
 */
export async function getAvailableVendors(): Promise<VendorOption[]> {
    try {
        const session = await auth();
        if (!session?.user?.id) {
            return [];
        }

        const { canCreateSecureLinks } = await import('@/lib/security/roles');
        if (!canCreateSecureLinks(session.user.role)) {
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
