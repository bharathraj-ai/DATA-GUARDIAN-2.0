/**
 * Canonical application roles — server-side source of truth.
 * Never trust client-sent role strings for authorization.
 */

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

/** Both roles are self-service — any new user picks one on first login (permanent). */
export const SELF_SERVICE_ROLES: AppRole[] = ['OWNER', 'VENDOR'];

export function isPrivilegedRole(_role: string): boolean {
  return false; // No privileged roles — both OWNER and VENDOR are self-service
}

export function isElevatedStaff(role: string | null | undefined): boolean {
  return false;
}
