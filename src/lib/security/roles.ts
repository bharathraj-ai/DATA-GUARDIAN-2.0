/**
 * Canonical application roles — server-side source of truth.
 * Never trust client-sent role strings for authorization.
 *
 * Pure helpers are re-exported from `role-helpers` so Client Components can
 * import those without pulling Prisma into the browser bundle.
 */

import 'server-only';
import { cache } from 'react';
import { prisma } from '@/lib/prisma';
import { canCreateSecureLinks, normalizeRole, type AppRole } from '@/lib/security/role-helpers';

export {
  APP_ROLES,
  ORG_MEMBER_ROLES,
  ROLE_RANK,
  SELF_SERVICE_ROLES,
  OWNER_ASSIGNABLE_ROLES,
  canCreateSecureLinks,
  canManageOrgMembers,
  dashboardPathForRole,
  isDashboardEntryPath,
  isElevatedStaff,
  isPrivilegedRole,
  isSelfServiceRole,
  normalizeRole,
  roleDisplayName,
  roleRank,
  type AppRole,
  type OrgMemberRole,
} from '@/lib/security/role-helpers';

/**
 * Load role from Postgres — authoritative for authorization.
 * Never use session.user.role alone for privileged mutations.
 */
export const getDbUserRole = cache(async function getDbUserRole(userId: string): Promise<{
  role: AppRole;
  roleSelected: boolean;
  organizationId: string | null;
} | null> {
  if (!userId) return null;
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { role: true, roleSelected: true, organizationId: true },
  });
  if (!user) return null;
  return {
    role: normalizeRole(user.role),
    roleSelected: user.roleSelected ?? false,
    organizationId: user.organizationId ?? null,
  };
});

/** True when DB says this user may create secure links (Team leader). */
export async function requireOwnerRole(userId: string): Promise<boolean> {
  const db = await getDbUserRole(userId);
  return Boolean(db && canCreateSecureLinks(db.role));
}

