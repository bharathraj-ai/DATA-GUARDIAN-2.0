'use server';

import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { isElevatedStaff, normalizeRole } from '@/lib/security/roles';

/**
 * Owner (or break-glass staff) grants another registered user access to an ONLYOFFICE `Document`.
 */
export async function grantDocumentAccess(
  documentId: string,
  granteeEmail: string,
  permission: 'view' | 'edit' = 'view',
): Promise<{ success: boolean; error?: string }> {
  const session = await auth();
  if (!session?.user?.id) {
    return { success: false, error: 'Not authenticated' };
  }

  const email = granteeEmail.trim().toLowerCase();
  if (!email) {
    return { success: false, error: 'Invalid email' };
  }

  const document = await prisma.document.findUnique({
    where: { id: documentId, isDeleted: false },
    select: { ownerId: true },
  });

  if (!document) {
    return { success: false, error: 'Document not found' };
  }

  const actorId = session.user.id;
  const canManage =
    document.ownerId === actorId || isElevatedStaff(normalizeRole((session.user as { role?: string }).role));

  if (!canManage) {
    return { success: false, error: 'Forbidden' };
  }

  const grantee = await prisma.user.findUnique({
    where: { email },
    select: { id: true },
  });

  if (!grantee) {
    return { success: false, error: 'Grantee must be a registered user with this email' };
  }

  if (grantee.id === document.ownerId) {
    return { success: false, error: 'Owner already has full access' };
  }

  await prisma.documentGrant.upsert({
    where: {
      documentId_granteeId: { documentId, granteeId: grantee.id },
    },
    create: {
      documentId,
      granteeId: grantee.id,
      permission,
    },
    update: { permission },
  });

  await logDocumentGrantAudit(documentId, actorId, email, permission);

  return { success: true };
}

async function logDocumentGrantAudit(
  documentId: string,
  actorId: string,
  granteeEmail: string,
  permission: string,
) {
  try {
    await prisma.documentAuditLog.create({
      data: {
        documentId,
        userId: actorId,
        action: 'edit',
        metadata: JSON.stringify({
          type: 'document_grant',
          granteeEmail: granteeEmail.substring(0, 2) + '***',
          permission,
        }),
      },
    });
  } catch {
    /* non-fatal */
  }
}
