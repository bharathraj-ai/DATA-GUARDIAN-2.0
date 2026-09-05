import { normalizeRole } from '@/lib/security/role-helpers';

/**
 * Role capability matrix for app actions.
 * Share-link file ACL is enforced separately in authorizeSecureLink / authorizeApiRequest.
 */

export type DocumentAction = 'upload' | 'view' | 'edit' | 'download' | 'delete';

const PERMISSION_MATRIX: Record<string, DocumentAction[]> = {
  OWNER: ['upload', 'view', 'edit', 'download', 'delete'],
  VENDOR: ['view', 'download'],
};

export function hasRolePermission(role: string, action: DocumentAction): boolean {
  const r = normalizeRole(role);
  const allowed = PERMISSION_MATRIX[r] ?? PERMISSION_MATRIX[role.toUpperCase()];
  if (!allowed) return false;
  return allowed.includes(action);
}
