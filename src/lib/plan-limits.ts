/**
 * Resolve effective plan limits for a user (org plan or FREE solo).
 */
import 'server-only';

import { prisma } from '@/lib/prisma';
import { limitsForPlan, type PlanLimits } from '@/lib/plans';

export async function resolvePlanLimitsForUser(userId: string): Promise<PlanLimits & { organizationId: string | null }> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      organizationId: true,
      Organization: { select: { plan: true, suspendedAt: true } },
    },
  });

  if (user?.Organization?.suspendedAt) {
    throw new Error('This company workspace is suspended. Contact support.');
  }

  const limits = limitsForPlan(user?.Organization?.plan);
  return { ...limits, organizationId: user?.organizationId ?? null };
}

export async function countActiveLinksForOwner(ownerId: string): Promise<number> {
  return prisma.secureLink.count({
    where: {
      ownerId,
      isRevoked: false,
      expiresAt: { gt: new Date() },
    },
  });
}
