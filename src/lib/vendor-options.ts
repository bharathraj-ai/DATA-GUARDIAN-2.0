import { cache } from 'react';
import { prisma } from '@/lib/prisma';

export type VendorOption = {
    email: string;
    name: string | null;
};

/** Deduped per RSC request. Uses User.role index. */
export const listVendorOptions = cache(async function listVendorOptions(): Promise<VendorOption[]> {
    return prisma.user.findMany({
        where: { role: 'VENDOR' },
        select: { email: true, name: true },
        orderBy: [{ name: 'asc' }, { email: 'asc' }],
        take: 200,
    });
});
