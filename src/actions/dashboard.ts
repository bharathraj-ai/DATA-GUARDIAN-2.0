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
    status: 'active' | 'expired' | 'revoked' | 'used' | 'break' | 'completed' | 'suspicious';
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
    files: { id: string; fileName: string; fileSize: number; fileType: string; status: string; viewCount?: number }[];
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
    if (new Date() > link.expiresAt) return 'expired';
    if (link.isUsed) return 'used';
    return 'active';
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
        select: { vendorEmail: true, level: true, isUsed: true, otpVerifiedAt: true },
    },
    VendorAccess: {
        select: { email: true, level: true, status: true },
        orderBy: { level: 'asc' as const },
    },
    _count: { select: { UserFile: true } },
} as const;

const VENDOR_LIST_SELECT = {
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
} as const;

/**
 * Vendor inbox: indexed lookups by email, then one SecureLink fetch by id.
 * Avoids OR + relation `some()` which the planner cannot use cleanly.
 */
async function findReceivedLinksByEmail(email: string) {
    const vendorRows = await prisma.vendorAccess.findMany({
        where: { email: { equals: email, mode: 'insensitive' } },
        select: { secureLinkId: true },
        take: 80,
    });
    const accessRows = await prisma.linkAccess.findMany({
        where: { vendorEmail: { equals: email, mode: 'insensitive' } },
        select: { secureLinkId: true },
        take: 80,
    });
    const ids = [...new Set([
        ...vendorRows.map((r) => r.secureLinkId),
        ...accessRows.map((r) => r.secureLinkId),
    ])];

    return prisma.secureLink.findMany({
        where:
            ids.length > 0
                ? { OR: [{ allowedVendorEmail: { equals: email, mode: 'insensitive' } }, { id: { in: ids } }] }
                : { allowedVendorEmail: { equals: email, mode: 'insensitive' } },
        orderBy: { createdAt: 'desc' },
        take: 80,
        select: {
            ...VENDOR_LIST_SELECT,
            LinkAccess: {
                select: { vendorEmail: true, level: true, isUsed: true, otpVerifiedAt: true },
                where: { vendorEmail: { equals: email, mode: 'insensitive' } },
                take: 1,
            },
            VendorAccess: {
                select: { email: true, level: true, status: true },
                where: { email: { equals: email, mode: 'insensitive' } },
                take: 1,
            },
        },
    });
}

function mapVendorLinks(links: Awaited<ReturnType<typeof findReceivedLinksByEmail>>): DashboardLink[] {
    return links.map((link) => {
        const vendorAccessRecord = link.VendorAccess?.[0];
        const vendorIsUsed = link.LinkAccess?.[0]?.isUsed ?? link.isUsed;
        const row = mapListLink({ ...link, _count: { UserFile: 0 } }, vendorIsUsed);
        if (vendorAccessRecord?.status === 'completed') {
            row.status = 'completed';
        } else if (vendorAccessRecord?.status === 'break' && row.status === 'used') {
            row.status = 'break';
        } else if (vendorAccessRecord?.status === 'expired' && row.isRevoked) {
            row.status = 'revoked';
        }
        return row;
    });
}

function mapListLink(link: any, effectiveIsUsed: boolean): DashboardLink {
    const primaryVendor = link.LinkAccess?.[0]?.vendorEmail || link.allowedVendorEmail || null;
    // Prefer link-level stamp; fall back to any vendor LinkAccess verify time
    const vendorVerifiedAt: Date | null =
        (link.LinkAccess || [])
            .map((a: { otpVerifiedAt?: Date | null }) => a.otpVerifiedAt)
            .filter(Boolean)
            .sort(
                (a: Date, b: Date) =>
                    new Date(b).getTime() - new Date(a).getTime(),
            )[0] ?? null;
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
        otpVerifiedAt: link.otpVerifiedAt ?? vendorVerifiedAt,
        status: getStatus({ ...link, isUsed: effectiveIsUsed }),
        fileCount: link._count?.UserFile ?? 0,
        files: [],
        auditLogs: [],
        otp: null,
    };
}

function historyStatusToLinkStatus(status: string): DashboardLink['status'] {
    if (status === 'completed') return 'completed';
    if (status === 'suspicious') return 'suspicious';
    if (status === 'revoked') return 'revoked';
    if (status === 'active') return 'active';
    if (status === 'cleaned') return 'expired';
    return 'expired';
}

function sendRecordToDashboardLink(record: SendHistoryRecord, email: string): DashboardLink {
    return {
        id: `history:${record.id}`,
        token: '',
        expiresAt: record.expiredAt || record.createdAt,
        isUsed: record.status === 'completed',
        isRevoked: record.status === 'revoked' || record.status === 'suspicious',
        createdAt: record.createdAt,
        allowedVendorEmail: record.vendorEmail,
        vendorAccess: [],
        vendors: [],
        purpose: record.topic,
        purposeDetail: null,
        notificationEmail: null,
        failedAttempts: 0,
        lockedAt: null,
        otpVerifiedAt: null,
        status: historyStatusToLinkStatus(record.status),
        fileCount: record.fileCount,
        files: [],
        auditLogs: [],
        otp: null,
        detailsLoaded: true,
    };
}

function mergeVendorInbox(links: DashboardLink[], records: SendHistoryRecord[], email: string): DashboardLink[] {
    const covered = new Set(
        links.map((l) => `${(l.purpose || '').toLowerCase()}|${(l.allowedVendorEmail || email).toLowerCase()}`),
    );
    const extras = records
        .filter((r) => {
            const emails = (r.vendorEmail || '').toLowerCase();
            if (!emails.includes(email.toLowerCase())) return false;
            const key = `${(r.topic || '').toLowerCase()}|${email.toLowerCase()}`;
            return !covered.has(key);
        })
        .map((r) => {
            const row = sendRecordToDashboardLink(r, email);
            if (row.status === 'active') {
                row.status = 'expired';
                row.isRevoked = false;
            }
            return row;
        });
    return [...links, ...extras].sort(
        (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    );
}

async function fetchVendorSendHistory(email: string): Promise<SendHistoryRecord[]> {
    const { vendorEmailEqualsWhere } = await import('@/lib/send-record');
    return prisma.sendRecord.findMany({
        where: vendorEmailEqualsWhere(email),
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
}

/**
 * Owner link list — slim payload for fast first paint.
 */
async function fetchOwnedLinksForOwner(userId: string): Promise<DashboardLink[]> {
    const links = await prisma.secureLink.findMany({
        where: { ownerId: userId },
        orderBy: { createdAt: 'desc' },
        take: 80,
        select: LIST_SELECT,
    });

    return links.map((link: any) => {
        const anyVendorUsed = link.LinkAccess?.some((a: any) => a.isUsed) || false;
        return mapListLink(link, link.isUsed || anyVendorUsed);
    });
}

export async function getOwnedLinks(userId: string): Promise<DashboardLink[]> {
    try {
        const session = await auth();
        if (!session?.user?.id || session.user.id !== userId) {
            console.error('[SECURITY] getOwnedLinks called with mismatched userId');
            return [];
        }

        return fetchOwnedLinksForOwner(userId);
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

        return mergeVendorInbox(
            mapVendorLinks(await findReceivedLinksByEmail(target)),
            await fetchVendorSendHistory(target),
            target,
        );
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

        const views = await prisma.fileViewEvent.groupBy({
            by: ['fileId'],
            where: { linkId },
            _count: { _all: true },
        });
        const countByFile = new Map(views.map((v) => [v.fileId, v._count._all]));

        return {
            success: true,
            files: link.UserFile.map((file) => ({
                ...file,
                viewCount: countByFile.get(file.id) ?? 0,
            })),
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
    const mapped = await fetchOwnedLinksForOwner(userId);
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

    return {
        links: mergeVendorInbox(
            mapVendorLinks(await findReceivedLinksByEmail(email)),
            await fetchVendorSendHistory(email),
            email,
        ),
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

    const links = await fetchOwnedLinksForOwner(userId);
    const history = await prisma.sendRecord.findMany({
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
    return { links, history };
}

/** True when the owner already has a live (unexpired, unused, unrevoked) share. */
export async function ownerHasActiveLink(userId: string): Promise<boolean> {
    const session = await auth();
    if (!session?.user?.id || session.user.id !== userId) return false;

    try {
        const candidates = await prisma.secureLink.findMany({
            where: {
                ownerId: userId,
                isRevoked: false,
                isUsed: false,
                expiresAt: { gt: new Date() },
            },
            select: { id: true },
            take: 25,
        });
        if (candidates.length === 0) return false;

        const usedAccess = await prisma.linkAccess.findMany({
            where: {
                secureLinkId: { in: candidates.map((c) => c.id) },
                isUsed: true,
            },
            select: { secureLinkId: true },
        });
        const usedIds = new Set(usedAccess.map((a) => a.secureLinkId));
        return candidates.some((c) => !usedIds.has(c.id));
    } catch (error) {
        console.warn('[ownerHasActiveLink] DB unavailable — allowing create-link:', error);
        return false;
    }
}
