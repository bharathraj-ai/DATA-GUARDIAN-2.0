/**
 * Apply pending organization invites after OAuth (no auth() dependency).
 */
import 'server-only';

import { prisma } from '@/lib/prisma';

export async function acceptPendingOrgInvites(
  userId: string,
  email: string | null | undefined,
): Promise<void> {
  if (!email) return;
  const normalized = email.trim().toLowerCase();
  const invites = await prisma.organizationInvite.findMany({
    where: {
      email: normalized,
      acceptedAt: null,
      expiresAt: { gt: new Date() },
    },
  });

  for (const invite of invites) {
    await prisma.$transaction([
      prisma.organizationMember.upsert({
        where: {
          organizationId_userId: {
            organizationId: invite.organizationId,
            userId,
          },
        },
        create: {
          organizationId: invite.organizationId,
          userId,
          role: invite.role,
          managerUserId: invite.managerUserId,
        },
        update: {
          role: invite.role,
          managerUserId: invite.managerUserId,
        },
      }),
      prisma.user.update({
        where: { id: userId },
        data: {
          organizationId: invite.organizationId,
          role: invite.role,
          roleSelected: true,
        },
      }),
      prisma.organizationInvite.update({
        where: { id: invite.id },
        data: { acceptedAt: new Date() },
      }),
    ]);
  }
}
