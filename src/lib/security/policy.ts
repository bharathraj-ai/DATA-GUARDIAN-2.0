/**
 * Server-side RBAC/ABAC policy middleware.
 * ALL capability decisions live here — the frontend receives only capability flags.
 * Never let the client compute `highestActiveLevel`, `isRestricted`, or `myAssignedLevel`.
 */

import { prisma } from '@/lib/prisma';
import { auth } from '@/lib/auth';
import { cookies } from 'next/headers';
import type { CapabilityFlags } from '@/lib/linkAuthorization';

export type PolicyContext = {
    secureLinkId: string;
    token: string;
    effectiveEmail: string | null;
    isOwner: boolean;
    vendorLevel: number; // 1 = highest authority (team leader), 2+ = members
    capabilities: CapabilityFlags;
    // Preemption: resolved fully server-side
    isEditingPreempted: boolean;
    preemptingUserLevel: number | null;
};

/**
 * Resolves full policy context for a token + authenticated user.
 * This is the single source of truth for all access decisions.
 */
export async function resolvePolicy(token: string): Promise<PolicyContext | null> {
    const cookieStore = await cookies();
    const session = await auth();

    const sessionEmail = session?.user?.email?.trim().toLowerCase() ?? null;
    const cookieEmail = cookieStore.get('vendor_email')?.value?.trim().toLowerCase() ?? null;
    const effectiveEmail = cookieEmail ?? sessionEmail;

    const secureLink = await prisma.secureLink.findUnique({
        where: { token },
        include: {
            User: { select: { id: true, email: true } },
            VendorAccess: { select: { email: true, level: true, isRevoked: true } },
            LinkAccess: { select: { vendorEmail: true, level: true, isUsed: true, lockedAt: true } },
        },
    });

    if (!secureLink || secureLink.isRevoked || secureLink.expiresAt < new Date()) {
        return null;
    }

    const isOwner =
        session?.user?.id !== undefined && session.user.id === secureLink.ownerId;

    // Find vendor level — lower number = more authority
    let vendorLevel = 99; // default = lowest privilege
    if (isOwner) {
        vendorLevel = 0; // owner has absolute authority
    } else if (effectiveEmail) {
        const linkAccessRecord = secureLink.LinkAccess.find(
            (a) => a.vendorEmail.toLowerCase() === effectiveEmail && !a.lockedAt,
        );
        if (linkAccessRecord) vendorLevel = linkAccessRecord.level;

        const vendorAccessRecord = secureLink.VendorAccess.find(
            (a) => a.email.toLowerCase() === effectiveEmail && !a.isRevoked,
        );
        if (vendorAccessRecord && vendorAccessRecord.level < vendorLevel) {
            vendorLevel = vendorAccessRecord.level;
        }
    }

    // Resolve base capabilities from link settings
    const isAuthorized = isOwner || vendorLevel < 99;
    const capabilities: CapabilityFlags = {
        canPreview: isAuthorized,
        canComment: isAuthorized && secureLink.allowComment,
        canDownload: isAuthorized && secureLink.allowDownload,
        canEdit: isAuthorized && secureLink.allowEditing,
    };

    // Server-side preemption: check active sessions from Redis/DB
    // A user is preempted if a LOWER-numbered (higher authority) vendor is online
    let isEditingPreempted = false;
    let preemptingUserLevel: number | null = null;

    if (capabilities.canEdit && !isOwner) {
        try {
            const threshold = new Date(Date.now() - 15_000); // 15-second TTL
            const activeSessions = await prisma.documentSession.findMany({
                where: { token, lastSeenAt: { gte: threshold } },
                select: { level: true, userId: true },
            });

            const highestAuthorityOnline = activeSessions.reduce(
                (min, s) => Math.min(min, s.level),
                99,
            );

            if (highestAuthorityOnline < vendorLevel) {
                // A higher-authority user is online — deny edit
                isEditingPreempted = true;
                preemptingUserLevel = highestAuthorityOnline;
                capabilities.canEdit = false;
            }
        } catch {
            // Fail-open on presence check error (do not block access)
        }
    }

    return {
        secureLinkId: secureLink.id,
        token,
        effectiveEmail,
        isOwner,
        vendorLevel,
        capabilities,
        isEditingPreempted,
        preemptingUserLevel,
    };
}
