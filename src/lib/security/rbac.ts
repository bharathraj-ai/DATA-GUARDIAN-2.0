import { prisma } from '@/lib/prisma';

/**
 * Role-Based Access Control (RBAC) for Document Operations
 *
 * Permission matrix:
 * ┌──────────┬────────┬──────┬──────┬──────────┬────────┐
 * │ Role     │ Upload │ Edit │ View │ Download │ Delete │
 * ├──────────┼────────┼──────┼──────┼──────────┼────────┤
 * │ OWNER    │   ✓    │  ✓   │  ✓   │    ✓     │   ✓    │
 * │ VENDOR   │   ✗    │  ✗   │  ✓   │    ✓     │   ✗    │
 * └──────────┴────────┴──────┴──────┴──────────┴────────┘
 */

export type DocumentAction = 'upload' | 'view' | 'edit' | 'download' | 'delete';

// Permission matrix — which roles can perform which actions
const PERMISSION_MATRIX: Record<string, DocumentAction[]> = {
  OWNER: ['upload', 'view', 'edit', 'download', 'delete'],
  VENDOR: ['view', 'download'],
};

/**
 * Check if a user role has permission for a given action.
 */
export function hasRolePermission(role: string, action: DocumentAction): boolean {
  const allowedActions = PERMISSION_MATRIX[role];
  if (!allowedActions) return false;
  return allowedActions.includes(action);
}

/**
 * Check if a specific user has permission to perform an action on a document.
 *
 * Rules:
 * 1. Check user's role against permission matrix
 * 2. For edit/delete: only the document OWNER (creator) can perform these
 * 3. For view/download: any authenticated user with the right role
 */
export async function checkDocumentPermission(
  userId: string,
  documentId: string,
  action: DocumentAction
): Promise<{ allowed: boolean; reason?: string }> {
  // Fetch user role
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { role: true },
  });

  if (!user) {
    return { allowed: false, reason: 'User not found' };
  }

  // Check role-level permission
  if (!hasRolePermission(user.role, action)) {
    return {
      allowed: false,
      reason: `Role '${user.role}' does not have '${action}' permission`,
    };
  }

  // For destructive/modification actions, verify document ownership
  if (['edit', 'delete'].includes(action)) {
    const document = await prisma.document.findUnique({
      where: { id: documentId },
      select: { ownerId: true, isDeleted: true },
    });

    if (!document) {
      return { allowed: false, reason: 'Document not found' };
    }

    if (document.isDeleted) {
      return { allowed: false, reason: 'Document has been deleted' };
    }

    if (document.ownerId !== userId) {
      return {
        allowed: false,
        reason: 'Only the document owner can perform this action',
      };
    }
  }

  return { allowed: true };
}

/**
 * Require permission — throws if not allowed.
 * Convenience wrapper for use in API routes.
 */
export async function requireDocumentPermission(
  userId: string,
  documentId: string,
  action: DocumentAction
): Promise<void> {
  const result = await checkDocumentPermission(userId, documentId, action);
  if (!result.allowed) {
    const error = new Error(result.reason || 'Permission denied');
    (error as Error & { status: number }).status = 403;
    throw error;
  }
}
