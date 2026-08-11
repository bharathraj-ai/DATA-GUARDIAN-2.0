'use server';

import { prisma } from '@/lib/prisma';
import { auth } from '@/lib/auth';

export interface DashboardLink {
    id: string;
    token: string;
    ownerToken?: string;
    expiresAt: Date;
    isUsed: boolean;
    isRevoked: boolean;
    createdAt: Date;
    allowedVendorEmail: string | null;
    vendorAccess: { email: string; level: number; status?: string }[];
    status: 'active' | 'expired' | 'revoked' | 'used' | 'break';
    /** Legacy field — OTPs are never persisted; always null. */
    otp: null;
    purpose: string | null;
    purposeDetail: string | null;
    notificationEmail: string | null;
    failedAttempts: number;
    lockedAt: Date | null;
    otpVerifiedAt: Date | null;
    fileCount: number;
    vendors: { vendorEmail: string; level: number }[];
    files: { id: string; fileName: string; fileSize: number; fileType: string; status: string }[];
    auditLogs: { action: string; timestamp: Date; reason: string | null }[];
    /** True when files/auditLogs were loaded via getLinkDetails */
    detailsLoaded?: boolean;
}

export interface SendHistoryRecord {
    id: string;
    topic: string;
    vendorEmail: string | null;
    fileCount: number;
    status: string;
    createdAt: Date;
    expiredAt: Date | null;
}

function getStatus(link: { expiresAt: Date; isUsed: boolean; isRevoked: boolean }): DashboardLink['status'] {
    if (link.isRevoked) return 'revoked';
    if (link.isUsed) return 'used';
    if (new Date() > link.expiresAt) return 'expired';
    return 'active';
}

function scheduleCleanupIfNeeded(links: DashboardLink[]) {
    if (!links.some((l) => l.status === 'expired' || l.status === 'revoked')) return;
    // Dynamic import keeps the cleanup module off the dashboard hot path
    import('@/actions/cleanup')
        .then((m) => m.cleanupExpiredData())
        .catch(() => {});
}

/** List-row fields only — no nested files/audits (loaded on expand). */
const LIST_SELECT = {
    id: true,
    token: true,
    ownerToken: true,
    expiresAt: true,
    isUsed: true,
    isRevoked: true,
    createdAt: true,
    purpose: true,
    purposeDetail: true,
    notificationEmail: true,
    failedAttempts: true,
    lockedAt: true,
    otpVerifiedAt: true,
    allowedVendorEmail: true,
    LinkAccess: {
        select: { vendorEmail: true, level: true, isUsed: true },
    },
    VendorAccess: {
        select: { email: true, level: true, status: true },
        orderBy: { level: 'asc' as const },
    },
    _count: { select: { UserFile: true } },
} as const;

function mapListLink(link: any, effectiveIsUsed: boolean): DashboardLink {
    const primaryVendor = link.LinkAccess?.[0]?.vendorEmail || link.allowedVendorEmail || null;
    return {
        id: link.id,
        token: link.token,
        ownerToken: link.ownerToken,
        expiresAt: link.expiresAt,
        isUsed: effectiveIsUsed,
        isRevoked: link.isRevoked,
        createdAt: link.createdAt,
        allowedVendorEmail: primaryVendor,
        vendorAccess: link.VendorAccess || [],
        vendors: link.LinkAccess || [],
        purpose: link.purpose,
        purposeDetail: link.purposeDetail,
        notificationEmail: link.notificationEmail,
        failedAttempts: link.failedAttempts,
        lockedAt: link.lockedAt,
        otpVerifiedAt: link.otpVerifiedAt,
        status: getStatus({ ...link, isUsed: effectiveIsUsed }),
        fileCount: link._count?.UserFile ?? 0,
        files: [],
        auditLogs: [],
        otp: null,
        detailsLoaded: false,
    };
}

/**
 * Owner link list — slim payload for fast first paint.
 */
export async function getOwnedLinks(userId: string): Promise<DashboardLink[]> {
    try {
        const session = await auth();
        if (!session?.user?.id || session.user.id !== userId) {
            console.error('[SECURITY] getOwnedLinks called with mismatched userId');
            return [];
        }

        const links = await prisma.secureLink.findMany({
            where: { ownerId: userId },
            orderBy: { createdAt: 'desc' },
            take: 50,
            select: LIST_SELECT,
        });

        const mapped = links.map((link: any) => {
            const anyVendorUsed = link.LinkAccess?.some((a: any) => a.isUsed) || false;
            return mapListLink(link, link.isUsed || anyVendorUsed);
        });

        scheduleCleanupIfNeeded(mapped);
        return mapped;
    } catch (error) {
        console.error('Error fetching owned links:', error);
        return [];
    }
}

/**
 * Vendor received links — no nested files/audits.
 */
export async function getReceivedLinks(email: string): Promise<DashboardLink[]> {
    try {
        const session = await auth();
        const sessionEmail = session?.user?.email?.toLowerCase();
        const target = email.toLowerCase();
        if (!sessionEmail || sessionEmail !== target) {
            console.error('[SECURITY] getReceivedLinks called with mismatched email');
            return [];
        }

        const links = await prisma.secureLink.findMany({
            where: {
                OR: [
                    { allowedVendorEmail: target },
                    { VendorAccess: { some: { email: target } } },
                    { LinkAccess: { some: { vendorEmail: target } } },
                ],
            },
            orderBy: { createdAt: 'desc' },
            take: 50,
            select: {
                id: true,
                token: true,
                expiresAt: true,
                isUsed: true,
                isRevoked: true,
                createdAt: true,
                purpose: true,
                purposeDetail: true,
                notificationEmail: true,
                failedAttempts: true,
                lockedAt: true,
                otpVerifiedAt: true,
                allowedVendorEmail: true,
                LinkAccess: {
                    select: { vendorEmail: true, level: true, isUsed: true },
                    where: { vendorEmail: target },
                    take: 1,
                },
                VendorAccess: {
                    select: { email: true, level: true, status: true },
                    where: { email: target },
                    take: 1,
                },
            },
        });

        const mapped = links.map((link: any) => {
            const vendorIsUsed = link.LinkAccess?.[0]?.isUsed ?? link.isUsed;
            const row = mapListLink({ ...link, _count: { UserFile: 0 } }, vendorIsUsed);
            const vendorAccessRecord = link.VendorAccess?.[0];
            if (row.status === 'used' && vendorAccessRecord?.status && vendorAccessRecord.status !== 'completed') {
                row.status = 'break';
            }
            return row;
        });

        scheduleCleanupIfNeeded(mapped);
        return mapped;
    } catch (error) {
        console.error('Error fetching received links:', error);
        return [];
    }
}

/**
 * Lazy-load files + recent audits when an owner expands a link card.
 */
export async function getLinkDetails(linkId: string): Promise<{
    success: boolean;
    files?: DashboardLink['files'];
    auditLogs?: DashboardLink['auditLogs'];
    error?: string;
}> {
    try {
        const session = await auth();
        if (!session?.user?.id) {
            return { success: false, error: 'Unauthorized' };
        }

        const link = await prisma.secureLink.findFirst({
            where: { id: linkId, ownerId: session.user.id },
            select: {
                UserFile: {
                    select: {
                        id: true,
                        fileName: true,
                        fileSize: true,
                        fileType: true,
                        status: true,
                    },
                },
                AuditLog: {
                    select: { action: true, timestamp: true, reason: true },
                    orderBy: { timestamp: 'desc' },
                    take: 5,
                },
            },
        });

        if (!link) return { success: false, error: 'Not found' };

        return {
            success: true,
            files: link.UserFile as DashboardLink['files'],
            auditLogs: link.AuditLog,
        };
    } catch (error) {
        console.error('Error fetching link details:', error);
        return { success: false, error: 'Failed' };
    }
}

export async function getSendHistory(userId: string): Promise<SendHistoryRecord[]> {
    try {
        const session = await auth();
        if (!session?.user?.id || session.user.id !== userId) {
            console.error('[SECURITY] getSendHistory called with mismatched userId');
            return [];
        }
        return await prisma.sendRecord.findMany({
            where: { ownerId: userId },
            orderBy: { createdAt: 'desc' },
            take: 100,
            select: {
                id: true,
                topic: true,
                vendorEmail: true,
                fileCount: true,
                status: true,
                createdAt: true,
                expiredAt: true,
            },
        });
    } catch (error) {
        console.error('Error fetching send history:', error);
        return [];
    }
}

/**
 * Single round-trip for owner dashboard first paint (auth once + slim links).
 * Used by the server page wrapper.
 */
export async function getOwnerDashboardInitial(): Promise<{
    links: DashboardLink[];
    userId: string | null;
    role: string | null;
    name: string | null;
    email: string | null;
}> {
    const session = await auth();
    if (!session?.user?.id) {
        return { links: [], userId: null, role: null, name: null, email: null };
    }

    const userId = session.user.id;
    const links = await prisma.secureLink.findMany({
        where: { ownerId: userId },
        orderBy: { createdAt: 'desc' },
        take: 50,
        select: LIST_SELECT,
    });

    const mapped = links.map((link: any) => {
        const anyVendorUsed = link.LinkAccess?.some((a: any) => a.isUsed) || false;
        return mapListLink(link, link.isUsed || anyVendorUsed);
    });
    scheduleCleanupIfNeeded(mapped);

    return {
        links: mapped,
        userId,
        role: (session.user as { role?: string }).role ?? null,
        name: session.user.name ?? null,
        email: session.user.email ?? null,
    };
}

/**
 * Single round-trip for vendor dashboard first paint.
 */
export async function getVendorDashboardInitial(): Promise<{
    links: DashboardLink[];
    email: string | null;
    name: string | null;
}> {
    const session = await auth();
    const email = session?.user?.email?.toLowerCase() ?? null;
    if (!email) {
        return { links: [], email: null, name: null };
    }

    // Reuse getReceivedLinks auth path but avoid double auth by inlining slim query
    const links = await prisma.secureLink.findMany({
        where: {
            OR: [
                { allowedVendorEmail: email },
                { VendorAccess: { some: { email } } },
                { LinkAccess: { some: { vendorEmail: email } } },
            ],
        },
        orderBy: { createdAt: 'desc' },
        take: 50,
        select: {
            id: true,
            token: true,
            expiresAt: true,
            isUsed: true,
            isRevoked: true,
            createdAt: true,
            purpose: true,
            purposeDetail: true,
            notificationEmail: true,
            failedAttempts: true,
            lockedAt: true,
            otpVerifiedAt: true,
            allowedVendorEmail: true,
            LinkAccess: {
                select: { vendorEmail: true, level: true, isUsed: true },
                where: { vendorEmail: email },
                take: 1,
            },
            VendorAccess: {
                select: { email: true, level: true, status: true },
                where: { email },
                take: 1,
            },
        },
    });

    const mapped = links.map((link: any) => {
        const vendorIsUsed = link.LinkAccess?.[0]?.isUsed ?? link.isUsed;
        const row = mapListLink({ ...link, _count: { UserFile: 0 } }, vendorIsUsed);
        const vendorAccessRecord = link.VendorAccess?.[0];
        if (row.status === 'used' && vendorAccessRecord?.status && vendorAccessRecord.status !== 'completed') {
            row.status = 'break';
        }
        return row;
    });
    scheduleCleanupIfNeeded(mapped);

    return {
        links: mapped,
        email,
        name: session?.user?.name ?? null,
    };
}

/**
 * Single auth + sequential queries for owner dashboard.
 * Avoids Promise.all pool contention on Neon PgBouncer.
 * Used by the local server page (onboarding-aware owner route).
 */
export async function getOwnerDashboardData(userId: string): Promise<{
    links: DashboardLink[];
    history: SendHistoryRecord[];
}> {
    const session = await auth();
    if (!session?.user?.id || session.user.id !== userId) {
        console.error('[SECURITY] getOwnerDashboardData called with mismatched userId');
        return { links: [], history: [] };
    }

    // Sequential on purpose — one connection at a time under a tight Neon pool
    const links = await getOwnedLinks(userId);
    const history = await getSendHistory(userId);
    return { links, history };
}

/** True when the owner already has a live (unexpired, unused, unrevoked) share. */
export async function ownerHasActiveLink(userId: string): Promise<boolean> {
    const session = await auth();
    if (!session?.user?.id || session.user.id !== userId) return false;

    const active = await prisma.secureLink.findFirst({
        where: {
            ownerId: userId,
            isRevoked: false,
            isUsed: false,
            expiresAt: { gt: new Date() },
            NOT: { LinkAccess: { some: { isUsed: true } } },
        },
        select: { id: true },
    });

    return Boolean(active);
}
