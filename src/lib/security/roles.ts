/**
 * Canonical application roles — server-side source of truth.
 * Never trust client-sent role strings for authorization.
 *
 * Pure helpers are re-exported from `role-helpers` so Client Components can
 * import those without pulling Prisma into the browser bundle.
 */

import { cache } from 'react';
import { prisma } from '@/lib/prisma';
import { canCreateSecureLinks, normalizeRole, type AppRole } from '@/lib/security/role-helpers';

export {
  APP_ROLES,
  ROLE_RANK,
  SELF_SERVICE_ROLES,
  canCreateSecureLinks,
  isElevatedStaff,
  isPrivilegedRole,
  normalizeRole,
  roleRank,
  type AppRole,
} from '@/lib/security/role-helpers';

/**
 * Load role from Postgres — authoritative for authorization.
 * Never use session.user.role alone for privileged mutations.
 */
export const getDbUserRole = cache(async function getDbUserRole(userId: string): Promise<{
  role: AppRole;
  roleSelected: boolean;
} | null> {
  if (!userId) return null;
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { role: true, roleSelected: true },
  });
  if (!user) return null;
  return {
    role: normalizeRole(user.role),
    roleSelected: user.roleSelected ?? false,
  };
});

/** True when DB says this user may perform OWNER-only actions. */
export async function requireOwnerRole(userId: string): Promise<boolean> {
  const db = await getDbUserRole(userId);
  return Boolean(db && canCreateSecureLinks(db.role));
}
