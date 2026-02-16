'use server';

import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

/**
 * Server action to set a user's role during initial signup.
 * Only allows setting role if roleSelected is still false (first-time selection).
 */
export async function setUserRole(role: 'OWNER' | 'VENDOR') {
    const session = await auth();

    if (!session?.user?.id) {
        return { success: false, error: 'Not authenticated' };
    }

    // Validate role value
    if (role !== 'OWNER' && role !== 'VENDOR') {
        return { success: false, error: 'Invalid role' };
    }

    // Check if user has already selected a role
    const user = await prisma.user.findUnique({
        where: { id: session.user.id },
        select: { roleSelected: true },
    });

    if (user?.roleSelected) {
        return { success: false, error: 'Role has already been selected' };
    }

    // Update user role
    await prisma.user.update({
        where: { id: session.user.id },
        data: {
            role,
            roleSelected: true,
        },
    });

    return { success: true, role };
}
