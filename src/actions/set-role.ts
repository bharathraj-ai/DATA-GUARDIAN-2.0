'use server';

import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import {
  SELF_SERVICE_ROLES,
  normalizeRole,
  type AppRole,
  type SetUserRoleResult,
} from '@/lib/security/role-helpers';
import { logger, redactEmail } from '@/lib/logger';

/**
 * First-time onboarding only.
 * New users pick OWNER or VENDOR — this choice is permanent.
 * Uses an atomic updateMany guard so concurrent requests cannot double-set.
 */
export async function setUserRole(role: AppRole): Promise<SetUserRoleResult> {
  const session = await auth();

  if (!session?.user?.id || !session.user.email) {
    return { success: false, error: 'Not authenticated' };
  }

  const normalized = normalizeRole(role);

  if (!SELF_SERVICE_ROLES.includes(normalized)) {
    return { success: false, error: 'Invalid role selection' };
  }

  const updated = await prisma.user.updateMany({
    where: {
      id: session.user.id,
      roleSelected: false,
    },
    data: {
      role: normalized,
      roleSelected: true,
    },
  });

  if (updated.count === 0) {
    const existing = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: { role: true, roleSelected: true },
    });
    if (existing?.roleSelected) {
      return { success: true, role: normalizeRole(existing.role) };
    }
    return { success: false, error: 'Failed to set role' };
  }

  await prisma.auditLog.create({
    data: {
      action: 'ROLE_SELECTED',
      reason: 'User completed first-time role selection',
      metadata: JSON.stringify({
        role: normalized,
        userId: session.user.id,
      }),
    },
  });

  logger.info(
    `[Google OAuth] Role selected email=${redactEmail(session.user.email)} role=${normalized} onboardingStep=COMPLETE`
  );

  return { success: true, role: normalized };
}
