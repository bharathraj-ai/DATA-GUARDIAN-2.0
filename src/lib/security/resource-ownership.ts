/**
 * Object-level ownership helpers (IDOR prevention).
 *
 * Rule: never trust a client-supplied id alone.
 * Always bind the resource to the authenticated share token / owner / grant.
 */

import { prisma } from '@/lib/prisma';

/**
 * Returns the UserFile only if it belongs to the SecureLink identified by `token`.
 * Use this before any read/write that takes a bare fileId from the client.
 */
export async function findUserFileForShareToken(
  fileId: string,
  token: string,
): Promise<{ id: string; secureLinkId: string } | null> {
  if (!fileId || !token) return null;

  return prisma.userFile.findFirst({
    where: {
      id: fileId,
      SecureLink: { token },
    },
    select: { id: true, secureLinkId: true },
  });
}

/**
 * Returns the FileVersion only if it belongs to the given fileId.
 */
export async function findFileVersionForFile(
  versionId: string,
  fileId: string,
): Promise<{ id: string; fileId: string } | null> {
  if (!versionId || !fileId) return null;

  return prisma.fileVersion.findFirst({
    where: { id: versionId, fileId },
    select: { id: true, fileId: true },
  });
}

/**
 * Returns the Annotation only if it belongs to the given fileId.
 */
export async function findAnnotationForFile(
  annotationId: string,
  fileId: string,
): Promise<{ id: string; fileId: string } | null> {
  if (!annotationId || !fileId) return null;

  return prisma.annotation.findFirst({
    where: { id: annotationId, fileId },
    select: { id: true, fileId: true },
  });
}

/**
 * Returns the Document only if the user owns it or has an explicit grant.
 */
export async function findDocumentForUser(
  documentId: string,
  userId: string,
): Promise<{ id: string; ownerId: string } | null> {
  if (!documentId || !userId) return null;

  const document = await prisma.document.findFirst({
    where: {
      id: documentId,
      isDeleted: false,
      OR: [
        { ownerId: userId },
        { grants: { some: { granteeId: userId } } },
      ],
    },
    select: { id: true, ownerId: true },
  });

  return document;
}

/** Normalize email for membership comparisons. */
export function normalizeEmail(value: string | null | undefined): string | null {
  const v = value?.trim().toLowerCase();
  return v || null;
}

/**
 * True if email is an allowed participant on the link (or open link with no gate).
 */
export function isLinkParticipant(
  email: string,
  link: {
    allowedVendorEmail: string | null;
    VendorAccess: { email: string; isRevoked: boolean }[];
    LinkAccess: { vendorEmail: string; lockedAt: Date | null }[];
  },
): boolean {
  const e = normalizeEmail(email);
  if (!e) return false;

  const hasGate =
    Boolean(link.allowedVendorEmail) ||
    link.VendorAccess.length > 0 ||
    link.LinkAccess.length > 0;

  if (!hasGate) return true;

  if (link.allowedVendorEmail && normalizeEmail(link.allowedVendorEmail) === e) {
    return true;
  }
  if (link.VendorAccess.some((v) => normalizeEmail(v.email) === e && !v.isRevoked)) {
    return true;
  }
  if (link.LinkAccess.some((a) => normalizeEmail(a.vendorEmail) === e && !a.lockedAt)) {
    return true;
  }
  return false;
}
