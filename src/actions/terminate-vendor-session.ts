'use server';

import { cookies } from 'next/headers';
import { prisma } from '@/lib/prisma';
import { tryValidateSession } from '@/lib/redis-helpers';

/**
 * Server-side session termination for security violations (tab switches, etc.).
 * Invalidates Redis session and clears vendor cookies so reload cannot resume access.
 */
export async function terminateVendorSession(
    token: string,
    reason: string,
): Promise<{ success: boolean }> {
    try {
        const cookieStore = await cookies();
        const sessionId = cookieStore.get('session_id')?.value;
        if (!sessionId) {
            return { success: false };
        }

        const sessionValid = await tryValidateSession(token, sessionId);
        if (sessionValid === false) {
            return { success: false };
        }

        const secureLink = await prisma.secureLink.findUnique({
            where: { token },
            select: { id: true, isRevoked: true },
        });

        if (!secureLink || secureLink.isRevoked) {
            return { success: false };
        }

        try {
            const { invalidateSession } = await import('@/lib/redis');
            await invalidateSession(token, false);
        } catch {
            // Redis optional — still clear cookies below
        }

        cookieStore.delete('session_id');
        cookieStore.delete('vendor_email');

        await prisma.auditLog.create({
            data: {
                action: 'CLIENT_SESSION_TERMINATED',
                linkId: secureLink.id,
                reason: `Security policy violation: ${reason}`,
                metadata: JSON.stringify({ reason }),
            },
        }).catch(() => {});

        return { success: true };
    } catch {
        return { success: false };
    }
}
