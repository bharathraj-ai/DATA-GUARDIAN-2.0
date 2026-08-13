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

const USER_FILE_CONTENT_SELECT = {
  id: true,
  fileName: true,
  fileType: true,
  fileSize: true,
  version: true,
  status: true,
  encryptedContent: true,
  iv: true,
  authTag: true,
  encryptedDek: true,
  mongoFileId: true,
  editingLocked: true,
  mongoFile: {
    select: {
      gridFSId: true,
      mimeType: true,
      status: true,
      isDeleted: true,
    },
  },
} as const;

export type UserFileContentRow = {
  mongoFileId?: string | null;
  fileSize?: number | null;
  mongoFile?: {
    gridFSId: string;
    mimeType?: string | null;
    status?: string | null;
    isDeleted: boolean;
  } | null;
};

/** GridFS id from the UserFile join — skips a second Prisma lookup. */
export function gridFsIdForFile(file: UserFileContentRow): string | null {
  const mongo = file.mongoFile;
  if (!mongo || mongo.isDeleted || !mongo.gridFSId) return null;
  return mongo.gridFSId;
}

/**
 * Load a single file's ciphertext only after ACL has already bound fileId → link.
 */
export async function loadUserFileContentForLink(fileId: string, secureLinkId: string) {
  if (!fileId || !secureLinkId) return null;

  return prisma.userFile.findFirst({
    where: { id: fileId, secureLinkId },
    select: USER_FILE_CONTENT_SELECT,
  });
}

/**
 * Load all files' ciphertext for a link (complete-work delivery). ACL must already pass.
 */
export async function loadUserFilesContentForLink(secureLinkId: string) {
  if (!secureLinkId) return [];

  return prisma.userFile.findMany({
    where: { secureLinkId },
    select: USER_FILE_CONTENT_SELECT,
    take: 50,
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
