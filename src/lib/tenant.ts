/**
 * Organization (tenant) helpers. Personal Gmail/Yahoo accounts stay org-less
 * until the owner creates a workspace from a company domain.
 */
import 'server-only';

import { prisma } from '@/lib/prisma';

const CONSUMER_DOMAINS = new Set([
    'gmail.com',
    'googlemail.com',
    'yahoo.com',
    'outlook.com',
    'hotmail.com',
    'live.com',
    'icloud.com',
    'proton.me',
    'protonmail.com',
    'aol.com',
]);

export function emailDomain(email: string | null | undefined): string | null {
    const at = email?.trim().toLowerCase().split('@')[1];
    return at || null;
}

export function isConsumerEmailDomain(domain: string | null): boolean {
    if (!domain) return true;
    return CONSUMER_DOMAINS.has(domain);
}

export function slugFromName(name: string): string {
    const base = name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '')
        .slice(0, 40);
    return base || `org-${Date.now().toString(36)}`;
}

export async function ensureOwnerOrganization(params: {
    userId: string;
    email: string | null | undefined;
    name?: string | null;
}): Promise<{ organizationId: string | null; kmsKeyId: string | null }> {
    const existing = await prisma.user.findUnique({
        where: { id: params.userId },
        select: {
            organizationId: true,
            Organization: { select: { id: true, kmsKeyId: true } },
        },
    });
    if (existing?.organizationId) {
        return {
            organizationId: existing.organizationId,
            kmsKeyId: existing.Organization?.kmsKeyId ?? null,
        };
    }

    const domain = emailDomain(params.email);
    if (!domain || isConsumerEmailDomain(domain)) {
        return { organizationId: null, kmsKeyId: null };
    }

    const byDomain = await prisma.organization.findFirst({
        where: { allowedDomain: domain },
        select: { id: true, kmsKeyId: true },
    });

    if (byDomain) {
        await prisma.$transaction([
            prisma.user.update({
                where: { id: params.userId },
                data: { organizationId: byDomain.id },
            }),
            prisma.organizationMember.upsert({
                where: {
                    organizationId_userId: {
                        organizationId: byDomain.id,
                        userId: params.userId,
                    },
                },
                create: {
                    organizationId: byDomain.id,
                    userId: params.userId,
                    role: 'OWNER',
                },
                update: {},
            }),
        ]);
        return { organizationId: byDomain.id, kmsKeyId: byDomain.kmsKeyId };
    }

    const name = domain.split('.')[0] || params.name || 'Workspace';
    let slug = slugFromName(name);
    const clash = await prisma.organization.findUnique({ where: { slug }, select: { id: true } });
    if (clash) slug = `${slug}-${params.userId.slice(-6)}`;

    const org = await prisma.organization.create({
        data: {
            name: name.charAt(0).toUpperCase() + name.slice(1),
            slug,
            allowedDomain: domain,
            plan: 'FREE',
            members: {
                // Founder holds OWNER seat on the org
                create: { userId: params.userId, role: 'OWNER' },
            },
            users: {
                connect: { id: params.userId },
            },
        },
        select: { id: true, kmsKeyId: true },
    });

    return { organizationId: org.id, kmsKeyId: org.kmsKeyId };
}

export async function attachUserToMatchingOrg(userId: string, email: string | null | undefined): Promise<void> {
    const domain = emailDomain(email);
    if (!domain || isConsumerEmailDomain(domain)) return;

    const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { organizationId: true },
    });
    if (user?.organizationId) return;

    const org = await prisma.organization.findFirst({
        where: { allowedDomain: domain },
        select: { id: true },
    });
    if (!org) return;

    await prisma.$transaction([
        prisma.user.update({
            where: { id: userId },
            data: { organizationId: org.id },
        }),
        prisma.organizationMember.upsert({
            where: { organizationId_userId: { organizationId: org.id, userId } },
            create: { organizationId: org.id, userId, role: 'OWNER' },
            update: {},
        }),
    ]);
}

export function assertEmailAllowedForHostedDomain(email: string | null | undefined): boolean {
    const required = process.env.GOOGLE_HOSTED_DOMAIN?.trim().toLowerCase();
    if (!required) return true;
    const domain = emailDomain(email);
    return domain === required;
}

export async function kmsKeyIdForUser(userId: string | null | undefined): Promise<string | null> {
    if (!userId) return null;
    const row = await prisma.user.findUnique({
        where: { id: userId },
        select: { Organization: { select: { kmsKeyId: true } } },
    });
    return row?.Organization?.kmsKeyId ?? null;
}

export async function kmsKeyIdForLink(linkId: string | null | undefined): Promise<string | null> {
    if (!linkId) return null;
    const row = await prisma.secureLink.findUnique({
        where: { id: linkId },
        select: { Organization: { select: { kmsKeyId: true } } },
    });
    return row?.Organization?.kmsKeyId ?? null;
}
