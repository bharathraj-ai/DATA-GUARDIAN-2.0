import { prisma } from '@/lib/prisma';
import { isElevatedStaff, normalizeRole } from '@/lib/security/roles';

/**
 * Role-Based Access Control for ONLYOFFICE `Document` records (filesystem-backed).
 *
 * Deny-by-default:
 * - Owner may perform actions allowed by their app role on **their** documents only.
 * - Non-owners require an explicit `DocumentGrant` row.
 * - SUPER_ADMIN / ADMIN may access any document for break-glass support (audit at call site).
 */

export type DocumentAction = 'upload' | 'view' | 'edit' | 'download' | 'delete';

const PERMISSION_MATRIX: Record<string, DocumentAction[]> = {
  OWNER: ['upload', 'view', 'edit', 'download', 'delete'],
  VENDOR: ['view', 'download'],
};

export function hasRolePermission(role: string, action: DocumentAction): boolean {
  const r = normalizeRole(role);
  const allowed = PERMISSION_MATRIX[r];
  if (!allowed) return false;
  return allowed.includes(action);
}

export type DocumentAccessResult = {
  allowed: boolean;
  reason?: string;
  /** True when SUPER_ADMIN/ADMIN bypassed ownership (caller must audit). */
  elevatedBreakGlass?: boolean;
};

/**
 * Enforce object-level authorization for `Document` by id.
 */
export async function checkDocumentPermission(
  userId: string,
  documentId: string,
  action: DocumentAction,
  loaded?: { ownerId: string; isDeleted: boolean },
): Promise<DocumentAccessResult> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { role: true },
  });

  if (!user) {
    return { allowed: false, reason: 'User not found' };
  }

  if (!hasRolePermission(user.role, action)) {
    return {
      allowed: false,
      reason: `Role '${normalizeRole(user.role)}' cannot perform '${action}'`,
    };
  }

  const document = loaded ?? await prisma.document.findUnique({
    where: { id: documentId },
    select: { ownerId: true, isDeleted: true },
  });

  if (!document) {
    return { allowed: false, reason: 'Document not found' };
  }

  if (document.isDeleted && action !== 'delete') {
    return { allowed: false, reason: 'Document has been deleted' };
  }

  if (isElevatedStaff(user.role)) {
    return { allowed: true, elevatedBreakGlass: true };
  }

  if (document.ownerId === userId) {
    return { allowed: true };
  }

  const grant = await prisma.documentGrant.findUnique({
    where: {
      documentId_granteeId: { documentId, granteeId: userId },
    },
    select: { permission: true },
  });

  if (!grant) {
    return { allowed: false, reason: 'No document access grant' };
  }

  const canRead = grant.permission === 'view' || grant.permission === 'edit';
  const canMutate = grant.permission === 'edit';

  if ((action === 'view' || action === 'download') && canRead) {
    return { allowed: true };
  }

  if (action === 'edit' && canMutate) {
    return { allowed: true };
  }

  return { allowed: false, reason: 'Grant does not permit this action' };
}

export async function requireDocumentPermission(
  userId: string,
  documentId: string,
  action: DocumentAction,
): Promise<void> {
  const result = await checkDocumentPermission(userId, documentId, action);
  if (!result.allowed) {
    const error = new Error(result.reason || 'Permission denied');
    (error as Error & { status: number }).status = 403;
    throw error;
  }
}
