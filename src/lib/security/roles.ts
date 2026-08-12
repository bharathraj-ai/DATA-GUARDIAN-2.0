/**
 * Canonical application roles — server-side source of truth.
 * Never trust client-sent role strings for authorization.
 */

import { prisma } from '@/lib/prisma';

export const APP_ROLES = [
  'OWNER',
  'VENDOR',
] as const;

export type AppRole = (typeof APP_ROLES)[number];

/** Lower number = higher privilege */
export const ROLE_RANK: Record<string, number> = {
  OWNER: 1,
  VENDOR: 2,
};

export function normalizeRole(role: string | null | undefined): AppRole {
  const r = (role || 'VENDOR').toUpperCase();
  if ((APP_ROLES as readonly string[]).includes(r)) return r as AppRole;
  return 'VENDOR';
}

export function roleRank(role: string | null | undefined): number {
  return ROLE_RANK[normalizeRole(role)] ?? 99;
}

/** Roles that may create secure links / owner dashboard features */
export function canCreateSecureLinks(role: string | null | undefined): boolean {
  const r = normalizeRole(role);
  return r === 'OWNER';
}

/**
 * Load role from Postgres — authoritative for authorization.
 * Never use session.user.role alone for privileged mutations.
 */
export async function getDbUserRole(userId: string): Promise<{
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
}

/** True when DB says this user may perform OWNER-only actions. */
export async function requireOwnerRole(userId: string): Promise<boolean> {
  const db = await getDbUserRole(userId);
  return Boolean(db && canCreateSecureLinks(db.role));
}

/** Both roles are self-service — any new user picks one on first login (permanent). */
export const SELF_SERVICE_ROLES: AppRole[] = ['OWNER', 'VENDOR'];

export function isPrivilegedRole(_role: string): boolean {
  return false; // No privileged roles — both OWNER and VENDOR are self-service
}

export function isElevatedStaff(role: string | null | undefined): boolean {
  return false;
}
