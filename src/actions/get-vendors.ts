'use server';

import { auth } from '@/lib/auth';
import { listVendorOptions, type VendorOption } from '@/lib/vendor-options';
import { logger } from '@/lib/logger';

export type { VendorOption };

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

        const { requireOwnerRole } = await import('@/lib/security/roles');
        if (!(await requireOwnerRole(session.user.id))) {
            return [];
        }

        return await listVendorOptions();
    } catch (error) {
        logger.error('Error fetching vendors', error);
        return [];
    }
}
