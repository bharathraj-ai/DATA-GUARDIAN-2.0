'use server';

import { auth } from '@/lib/auth';
import { listVendorOptions, type VendorOption } from '@/lib/vendor-options';

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

        const { canCreateSecureLinks } = await import('@/lib/security/roles');
        if (!canCreateSecureLinks(session.user.role)) {
            return [];
        }

        return await listVendorOptions();
    } catch (error) {
        console.error('Error fetching vendors:', error);
        return [];
    }
}
