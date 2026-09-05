/**
 * Pure role helpers — safe to import from Client Components.
 * DB-backed checks live in `@/lib/security/roles` (Prisma, server-only).
 *
 * Hierarchy: OWNER → VENDOR
 */

export const APP_ROLES = [
  'OWNER',
  'VENDOR',
] as const;

export type AppRole = (typeof APP_ROLES)[number];

/** Org membership roles (vendors are not org members by default). */
export const ORG_MEMBER_ROLES = ['OWNER'] as const;
export type OrgMemberRole = (typeof ORG_MEMBER_ROLES)[number];

/** Result of first-time role assignment (shared client/server). */
export type SetUserRoleResult =
  | { success: true; role: AppRole }
  | { success: false; error: string };

/** Lower number = higher privilege */
export const ROLE_RANK: Record<AppRole, number> = {
  OWNER: 1,
  VENDOR: 2,
};

const ROLE_SET = new Set<string>(APP_ROLES);

/**
 * Normalize stored/JWT role strings.
 * Legacy `TEAM_LEADER` and `MANAGER` map to `OWNER`. Unknown → VENDOR (fail closed).
 */
export function normalizeRole(role: string | null | undefined): AppRole {
  const r = (role || 'VENDOR').toUpperCase();
  if (r === 'TEAM_LEADER' || r === 'MANAGER') return 'OWNER';
  if (ROLE_SET.has(r)) return r as AppRole;
  return 'VENDOR';
}

export function roleRank(role: string | null | undefined): number {
  return ROLE_RANK[normalizeRole(role)] ?? 99;
}

export function roleDisplayName(role: string | null | undefined): string {
  switch (normalizeRole(role)) {
    case 'OWNER':
      return 'Owner';
    default:
      return 'Vendor';
  }
}

/** Roles that may create secure links / owner-dashboard share features */
export function canCreateSecureLinks(role: string | null | undefined): boolean {
  return normalizeRole(role) === 'OWNER';
}

/** Staff who manage companies / org structure (not self-serve). */
export function isElevatedStaff(role: string | null | undefined): boolean {
  return false;
}

export function isPrivilegedRole(role: string): boolean {
  return normalizeRole(role) === 'OWNER';
}

export function canManageOrgMembers(role: string | null | undefined): boolean {
  return normalizeRole(role) === 'OWNER';
}

export function canOverseeTeamLeaders(role: string | null | undefined): boolean {
  return false;
}

export function dashboardPathForRole(role: string | null | undefined): string {
  switch (normalizeRole(role)) {
    case 'OWNER':
      return '/dashboard/owner';
    default:
      return '/dashboard/vendor';
  }
}

/** `/dashboard` and role dashboards — skip the extra hop, go straight to role path. */
export function isDashboardEntryPath(path: string): boolean {
  return (
    path === '/dashboard' ||
    path.startsWith('/dashboard?') ||
    path === '/dashboard/owner' ||
    path.startsWith('/dashboard/owner?') ||
    path === '/dashboard/vendor' ||
    path.startsWith('/dashboard/vendor?')
  );
}

/** Self-serve first login — Owner or Vendor only. */
export const SELF_SERVICE_ROLES: AppRole[] = ['OWNER', 'VENDOR'];

export function isSelfServiceRole(role: string | null | undefined): boolean {
  return SELF_SERVICE_ROLES.includes(normalizeRole(role));
}

/** Roles an OWNER may assign below them. (none currently) */
export const OWNER_ASSIGNABLE_ROLES: OrgMemberRole[] = [];
