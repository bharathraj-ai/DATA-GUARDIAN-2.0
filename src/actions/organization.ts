'use server';

import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import {
  OWNER_ASSIGNABLE_ROLES,
  normalizeRole,
  type OrgMemberRole,
} from '@/lib/security/role-helpers';
import { emailDomain, isConsumerEmailDomain } from '@/lib/tenant';
import { normalizePlan, type PlanId } from '@/lib/plans';
import { logger, redactEmail } from '@/lib/logger';

export type OrgMemberRow = {
  id: string;
  userId: string;
  email: string;
  name: string | null;
  role: string;
  managerUserId: string | null;
  createdAt: Date;
};

export type OrgInviteRow = {
  id: string;
  email: string;
  role: string;
  managerUserId: string | null;
  expiresAt: Date;
  createdAt: Date;
};

export type CompanyOverview = {
  id: string;
  name: string;
  slug: string;
  allowedDomain: string | null;
  plan: PlanId;
  suspendedAt: Date | null;
  kmsKeyId: string | null;
  members: OrgMemberRow[];
  invites: OrgInviteRow[];
  linkCount: number;
};

async function actorContext(userId: string) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      email: true,
      role: true,
      organizationId: true,
      memberships: {
        select: { organizationId: true, role: true, managerUserId: true },
      },
    },
  });
  if (!user) return null;
  return {
    ...user,
    appRole: normalizeRole(user.role),
  };
}

function membershipRole(
  actor: NonNullable<Awaited<ReturnType<typeof actorContext>>>,
  organizationId: string,
): string | null {
  return actor.memberships.find((m) => m.organizationId === organizationId)?.role ?? null;
}

function canManageOrg(
  actor: NonNullable<Awaited<ReturnType<typeof actorContext>>>,
  organizationId: string,
): boolean {
  if (actor.appRole === 'OWNER' && actor.organizationId === organizationId) return true;
  return membershipRole(actor, organizationId) === 'OWNER';
}

export async function getCompanyOverview(): Promise<
  { ok: true; org: CompanyOverview } | { ok: false; error: string }
> {
  const session = await auth();
  if (!session?.user?.id) return { ok: false, error: 'Not authenticated' };

  const actor = await actorContext(session.user.id);
  if (!actor) return { ok: false, error: 'User not found' };

  let organizationId = actor.organizationId;


  if (!organizationId) {
    return { ok: false, error: 'No company workspace on this account' };
  }

  if (!canManageOrg(actor, organizationId)) {
    return { ok: false, error: 'Insufficient permissions' };
  }

  const org = await prisma.organization.findUnique({
    where: { id: organizationId },
    include: {
      members: {
        include: {
          user: { select: { id: true, email: true, name: true } },
        },
        orderBy: { createdAt: 'asc' },
      },
      invites: {
        where: { acceptedAt: null, expiresAt: { gt: new Date() } },
        orderBy: { createdAt: 'desc' },
      },
      _count: { select: { links: true } },
    },
  });

  if (!org) return { ok: false, error: 'Company not found' };

  const members = org.members;

  return {
    ok: true,
    org: {
      id: org.id,
      name: org.name,
      slug: org.slug,
      allowedDomain: org.allowedDomain,
      plan: normalizePlan(org.plan),
      suspendedAt: org.suspendedAt,
      kmsKeyId: org.kmsKeyId,
      linkCount: org._count.links,
      members: members.map((m) => ({
        id: m.id,
        userId: m.userId,
        email: m.user.email,
        name: m.user.name,
        role: m.role,
        managerUserId: m.managerUserId,
        createdAt: m.createdAt,
      })),
      invites: org.invites.map((i) => ({
        id: i.id,
        email: i.email,
        role: i.role,
        managerUserId: i.managerUserId,
        expiresAt: i.expiresAt,
        createdAt: i.createdAt,
      })),
    },
  };
}

export async function updateCompanySettings(input: {
  name?: string;
  allowedDomain?: string | null;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const session = await auth();
  if (!session?.user?.id) return { ok: false, error: 'Not authenticated' };
  const actor = await actorContext(session.user.id);
  if (!actor?.organizationId) return { ok: false, error: 'No company' };
  if (!canManageOrg(actor, actor.organizationId)) {
    return { ok: false, error: 'Only owners can update settings' };
  }

  const data: { name?: string; allowedDomain?: string | null } = {};
  if (typeof input.name === 'string' && input.name.trim()) {
    data.name = input.name.trim().slice(0, 80);
  }
  if (input.allowedDomain !== undefined) {
    const d = input.allowedDomain?.trim().toLowerCase() || null;
    if (d && isConsumerEmailDomain(d)) {
      return { ok: false, error: 'Consumer email domains cannot be company domains' };
    }
    data.allowedDomain = d;
  }

  await prisma.organization.update({
    where: { id: actor.organizationId },
    data,
  });
  return { ok: true };
}

export async function inviteOrgMember(input: {
  email: string;
  role: OrgMemberRole;
  managerUserId?: string | null;
}): Promise<{ ok: true; token: string } | { ok: false; error: string }> {
  const session = await auth();
  if (!session?.user?.id) return { ok: false, error: 'Not authenticated' };
  const actor = await actorContext(session.user.id);
  if (!actor?.organizationId) return { ok: false, error: 'No company' };

  const email = input.email.trim().toLowerCase();
  if (!email.includes('@')) return { ok: false, error: 'Invalid email' };

  const org = await prisma.organization.findUnique({
    where: { id: actor.organizationId },
    select: { id: true, allowedDomain: true, name: true },
  });
  if (!org) return { ok: false, error: 'Company not found' };

  if (org.allowedDomain) {
    const d = emailDomain(email);
    if (d !== org.allowedDomain) {
      return { ok: false, error: `Email must be @${org.allowedDomain}` };
    }
  }

  const isOwner = canManageOrg(actor, org.id);

  if (!isOwner) {
    return { ok: false, error: 'Insufficient permissions' };
  }

  const role = 'OWNER';
  const managerUserId = null;

  const expiresAt = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000);
  const token = `inv_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
  const rotated = await prisma.organizationInvite.upsert({
    where: {
      organizationId_email: { organizationId: org.id, email },
    },
    create: {
      organizationId: org.id,
      email,
      role,
      managerUserId,
      invitedById: actor.id,
      expiresAt,
      token,
    },
    update: {
      role,
      managerUserId,
      invitedById: actor.id,
      expiresAt,
      acceptedAt: null,
      token,
    },
  });

  await prisma.auditLog.create({
    data: {
      action: 'ORG_INVITE_SENT',
      reason: `Invited ${role}`,
      metadata: JSON.stringify({
        organizationId: org.id,
        email: redactEmail(email),
        role,
        invitedBy: actor.id,
      }),
    },
  });

  logger.info(`[Org] Invite sent org=${org.id} email=${redactEmail(email)} role=${role}`);
  return { ok: true, token: rotated.token };
}

export async function removeOrgMember(
  memberUserId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const session = await auth();
  if (!session?.user?.id) return { ok: false, error: 'Not authenticated' };
  const actor = await actorContext(session.user.id);
  if (!actor?.organizationId) return { ok: false, error: 'No company' };
  if (!canManageOrg(actor, actor.organizationId)) {
    return { ok: false, error: 'Only owners can remove members' };
  }
  if (memberUserId === actor.id) {
    return { ok: false, error: 'Cannot remove yourself' };
  }

  await prisma.$transaction([
    prisma.organizationMember.deleteMany({
      where: { organizationId: actor.organizationId, userId: memberUserId },
    }),
    prisma.user.updateMany({
      where: { id: memberUserId, organizationId: actor.organizationId },
      data: { organizationId: null },
    }),
  ]);
  return { ok: true };
}



/** Apply pending invites for this email after sign-in. */
export async function acceptPendingOrgInvitesForSession(): Promise<void> {
  const session = await auth();
  if (!session?.user?.id) return;
  const { acceptPendingOrgInvites } = await import('@/lib/org-invites');
  await acceptPendingOrgInvites(session.user.id, session.user.email);
}



export async function requestPlanUpgrade(
  plan: PlanId,
  note?: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const session = await auth();
  if (!session?.user?.id) return { ok: false, error: 'Not authenticated' };
  const actor = await actorContext(session.user.id);
  if (!actor?.organizationId) return { ok: false, error: 'No company' };
  if (!canManageOrg(actor, actor.organizationId)) {
    return { ok: false, error: 'Only owners can request upgrades' };
  }

  await prisma.auditLog.create({
    data: {
      action: 'PLAN_UPGRADE_REQUEST',
      reason: `Requested ${plan}`,
      metadata: JSON.stringify({
        organizationId: actor.organizationId,
        plan,
        note: note?.slice(0, 500) || null,
        email: redactEmail(actor.email),
      }),
    },
  });
  return { ok: true };
}

