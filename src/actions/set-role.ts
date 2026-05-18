'use server';

import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import {
  SELF_SERVICE_ROLES,
  normalizeRole,
  type AppRole,
} from '@/lib/security/roles';

/**
 * First-time onboarding only.
 * Any new user can pick OWNER or VENDOR — this choice is permanent.
 */
export async function setUserRole(role: AppRole) {
  const session = await auth();

  if (!session?.user?.id || !session.user.email) {
    return { success: false, error: 'Not authenticated' };
  }

  const normalized = normalizeRole(role);

  // Only OWNER and VENDOR are valid choices
  if (!SELF_SERVICE_ROLES.includes(normalized)) {
    return { success: false, error: 'Invalid role selection' };
  }

  // Check if role was already selected (one-time only)
  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { roleSelected: true },
  });

  if (user?.roleSelected) {
    return { success: false, error: 'Role has already been selected' };
  }

  await prisma.user.update({
    where: { id: session.user.id },
    data: {
      role: normalized,
      roleSelected: true,
    },
  });

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

  return { success: true, role: normalized };
}
