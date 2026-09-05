'use server';

import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { normalizeRole, roleDisplayName } from '@/lib/security/role-helpers';
import { normalizePlan } from '@/lib/plans';
import { logger, redactEmail } from '@/lib/logger';

export type SettingsSnapshot = {
  id: string;
  email: string;
  name: string | null;
  image: string | null;
  role: string;
  roleLabel: string;
  organizationId: string | null;
  organizationName: string | null;
  organizationPlan: string | null;
  memberRole: string | null;
  createdAt: Date;
};

export async function getSettingsSnapshot(): Promise<
  { ok: true; data: SettingsSnapshot } | { ok: false; error: string }
> {
  const session = await auth();
  if (!session?.user?.id) return { ok: false, error: 'Not authenticated' };

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: {
      id: true,
      email: true,
      name: true,
      image: true,
      role: true,
      organizationId: true,
      createdAt: true,
      Organization: { select: { name: true, plan: true } },
      memberships: {
        where: session.user.organizationId
          ? { organizationId: session.user.organizationId }
          : undefined,
        select: { role: true },
        take: 1,
      },
    },
  });

  if (!user) return { ok: false, error: 'User not found' };

  const role = normalizeRole(user.role);
  return {
    ok: true,
    data: {
      id: user.id,
      email: user.email,
      name: user.name,
      image: user.image,
      role,
      roleLabel: roleDisplayName(role),
      organizationId: user.organizationId,
      organizationName: user.Organization?.name ?? null,
      organizationPlan: user.Organization ? normalizePlan(user.Organization.plan) : null,
      memberRole: user.memberships[0]?.role ?? null,
      createdAt: user.createdAt,
    },
  };
}

export async function requestAccountExport(): Promise<{ ok: true } | { ok: false; error: string }> {
  const session = await auth();
  if (!session?.user?.id || !session.user.email) {
    return { ok: false, error: 'Not authenticated' };
  }

  await prisma.auditLog.create({
    data: {
      action: 'ACCOUNT_EXPORT_REQUEST',
      reason: 'User requested data export',
      metadata: JSON.stringify({
        userId: session.user.id,
        email: redactEmail(session.user.email),
      }),
    },
  });
  logger.info(`[Settings] Export requested userId=${session.user.id}`);
  return { ok: true };
}

export async function requestAccountDeletion(): Promise<{ ok: true } | { ok: false; error: string }> {
  const session = await auth();
  if (!session?.user?.id || !session.user.email) {
    return { ok: false, error: 'Not authenticated' };
  }

  await prisma.auditLog.create({
    data: {
      action: 'ACCOUNT_DELETE_REQUEST',
      reason: 'User requested account deletion',
      metadata: JSON.stringify({
        userId: session.user.id,
        email: redactEmail(session.user.email),
      }),
    },
  });
  logger.info(`[Settings] Delete requested userId=${session.user.id}`);
  return { ok: true };
}
