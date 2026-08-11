import { cookies } from 'next/headers';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { tryCheckRevoked, tryValidateSession } from '@/lib/redis-helpers';
import { decryptData } from '@/lib/crypto';
import { Prisma } from '@prisma/client';
import { verifyShareSession } from '@/lib/share-session';

export type CapabilityFlags = {
  canEdit: boolean;
  canPreview: boolean;
  canComment: boolean;
  canDownload: boolean;
};

export type AuthorizationResult<T extends boolean = true> =
  | { success: true; context: LinkAuthorizationContext }
  | { success: false; status: number; error: string };

export type SecureLinkWithRelations = Prisma.SecureLinkGetPayload<{
  select: {
    id: true,
    token: true,
    otpHash: true,
    expiresAt: true,
    isUsed: true,
    createdAt: true,
    userId: true,
    isRevoked: true,
    ownerToken: true,
    deviceHash: true,
    failedAttempts: true,
    lockedAt: true,
    notificationEmail: true,
    purpose: true,
    purposeDetail: true,
    otpFirstAttemptAt: true,
    otpVerifiedAt: true,
    allowedVendorEmail: true,
    allowEditing: true,
    allowDownload: true,
    allowComment: true,
    maxViews: true,
    maxDownloads: true,
    ownerId: true,
    User: { select: { id: true, email: true, name: true } },
    VendorAccess: {
      select: {
        id: true,
        email: true,
        level: true,
        isRevoked: true,
        status: true,
        activeSessionId: true,
        activeDeviceHash: true,
        lastSavedWork: true,
        resumePoint: true,
      },
    },
    LinkAccess: {
      select: {
        vendorEmail: true,
        level: true,
        lockedAt: true,
        isUsed: true,
      },
    },
    UserFile: {
      select: {
        id: true,
        fileName: true,
        fileType: true,
        fileSize: true,
        version: true,
        status: true,
        mongoFileId: true,
        editingLocked: true,
      },
    },
  },
}>;

export type LinkAuthorizationContext = {
  secureLink: SecureLinkWithRelations;
  sessionId: string;
  effectiveEmail: string | null;
  isOwner: boolean;
  vendorAccess: { level: number; isRevoked: boolean } | null;
  capabilities: CapabilityFlags;
};



function normalizeEmail(value: string | null | undefined): string | null {
  return value?.trim().toLowerCase() || null;
}

function resolveCapabilities(
  secureLink: NonNullable<LinkAuthorizationContext['secureLink']>,
  isAuthorized: boolean,
  isOwner: boolean,
) {
  const member = isAuthorized || isOwner;
  const canPreview = member;
  const canEdit = Boolean(secureLink.allowEditing) && member;
  const canComment = (secureLink.allowComment ?? true) && member;
  const canDownload = isOwner || (Boolean(secureLink.allowDownload) && isAuthorized);

  return {
    canEdit,
    canPreview,
    canComment,
    canDownload,
  } satisfies CapabilityFlags;
}

export async function authorizeSecureLink(
  token: string,
  action: 'view' | 'preview' | 'edit' | 'download' | 'comment' = 'view',
  fileId?: string,
): Promise<AuthorizationResult> {
  if (!token) {
    return { success: false, status: 400, error: 'Missing access token' };
  }

  const cookieStore = await cookies();
  const sessionCookie = cookieStore.get('session_id')?.value;
  const verified = verifyShareSession(sessionCookie, token);
  if (!verified.valid) {
    return { success: false, status: 401, error: 'Unauthorized: Missing or invalid session' };
  }
  const sessionId = verified.sessionId;

  try {
    // Optional Redis kill-switch cache (null = use DB below)
    const revoked = await tryCheckRevoked(token);
    if (revoked === true) {
      console.warn('[SECURITY] Access blocked: token confirmed revoked in Redis cache');
      return { success: false, status: 403, error: 'Forbidden: Access revoked' };
    }

    // Optional Redis session cache (null = signed cookie is enough)
    const validSession = await tryValidateSession(token, sessionId);
    if (validSession === false) {
      console.warn('[SECURITY] Access blocked: session explicitly invalid in Redis cache');
      return { success: false, status: 401, error: 'Unauthorized: Session invalid or expired' };
    }
  } catch (err) {
    console.error('[SECURITY] Exception during session validation:', err);
    return { success: false, status: 401, error: 'Authentication infrastructure unavailable' };
  }

  const secureLink = await prisma.secureLink.findUnique({
    where: { token },
    select: {
      id: true,
      token: true,
      otpHash: true,
      expiresAt: true,
      isUsed: true,
      createdAt: true,
      userId: true,
      isRevoked: true,
      ownerToken: true,
      deviceHash: true,
      failedAttempts: true,
      lockedAt: true,
      notificationEmail: true,
      purpose: true,
      purposeDetail: true,
      otpFirstAttemptAt: true,
      otpVerifiedAt: true,
      allowedVendorEmail: true,
      allowEditing: true,
      allowDownload: true,
      allowComment: true,
      maxViews: true,
      maxDownloads: true,
      ownerId: true,
      User: { select: { id: true, email: true, name: true } },
      VendorAccess: {
        select: {
          id: true,
          email: true,
          level: true,
          isRevoked: true,
          status: true,
          activeSessionId: true,
          activeDeviceHash: true,
          lastSavedWork: true,
          resumePoint: true,
        },
      },
      LinkAccess: {
        select: {
          vendorEmail: true,
          level: true,
          lockedAt: true,
          isUsed: true,
        },
      },
      // Metadata only — never load encryptedContent on the ACL hot path.
      UserFile: {
        select: {
          id: true,
          fileName: true,
          fileType: true,
          fileSize: true,
          version: true,
          status: true,
          mongoFileId: true,
          editingLocked: true,
        },
      },
    },
  });

  if (!secureLink) {
    return { success: false, status: 404, error: 'Invalid secure link' };
  }

  if (secureLink.isRevoked || secureLink.expiresAt < new Date()) {
    return { success: false, status: 403, error: 'Forbidden: Link has expired or been revoked' };
  }

  const authSession = await auth();
  const sessionEmail = normalizeEmail(authSession?.user?.email);
  // SEC-3: vendor_email cookie is AES-256-GCM encrypted — decrypt before use.
  // Falls back gracefully to plaintext for backward compatibility with existing sessions.
  const rawCookieEmail = cookieStore.get('vendor_email')?.value;
  let cookieEmail: string | null = null;
  if (rawCookieEmail) {
    try {
      const decoded = decryptData<{ email: string }>(rawCookieEmail);
      cookieEmail = normalizeEmail(decoded.email);
    } catch {
      // Graceful fallback: plaintext cookie from a pre-encryption session
      cookieEmail = normalizeEmail(rawCookieEmail.includes(':') ? null : rawCookieEmail);
    }
  }
  const effectiveEmail = cookieEmail || sessionEmail;
  const isOwner = authSession?.user?.id !== undefined && authSession.user.id === secureLink.ownerId;

  const hasEmailGate =
    Boolean(secureLink.allowedVendorEmail) ||
    secureLink.LinkAccess.length > 0 ||
    secureLink.VendorAccess.length > 0;

  let vendorAccessRecord: { level: number; isRevoked: boolean } | null = null;
  let isAuthorized = false;
  let effectiveIsUsed = secureLink.isUsed; // Track effective isUsed for the user

  // Cache normalized email once — avoids repeated toLowerCase().trim() calls
  const normalizedEffective = normalizeEmail(effectiveEmail);

  if (isOwner) {
    isAuthorized = true;
    effectiveIsUsed = true; // Owners don't need OTP
  } else if (!hasEmailGate) {
    isAuthorized = true;
  } else if (normalizedEffective) {
    if (secureLink.allowedVendorEmail && normalizeEmail(secureLink.allowedVendorEmail) === normalizedEffective) {
      isAuthorized = true;
    }

    const linkAccess = secureLink.LinkAccess.find(
      (access) => normalizeEmail(access.vendorEmail) === normalizedEffective && !access.lockedAt,
    );
    if (linkAccess) {
      vendorAccessRecord = { level: linkAccess.level, isRevoked: false };
      effectiveIsUsed = linkAccess.isUsed; // Use LinkAccess isUsed
      isAuthorized = true;
    }

    const vendor = secureLink.VendorAccess.find(
      (access) => normalizeEmail(access.email) === normalizedEffective && !access.isRevoked,
    );
    if (vendor) {
      vendorAccessRecord = vendorAccessRecord ?? { level: vendor.level, isRevoked: false };
      isAuthorized = true;
      // VendorAccess uses secureLink.isUsed (verify-otp sets it on the parent link)
    }
  }

  if (!isAuthorized) {
    return { success: false, status: 403, error: 'Forbidden: Identity mismatch or access denied' };
  }

  if (!effectiveIsUsed) {
    return { success: false, status: 401, error: 'Unauthorized: OTP verification required' };
  }

  // Active-session device binding (skip for owners). Denies reuse of this
  // session from another browser — does NOT permanently bind the share link.
  if (!isOwner) {
    const { headers } = await import('next/headers');
    const { generateDeviceHash } = await import('@/lib/fingerprint');
    const { DEVICE_MISMATCH_ERROR, isSessionDeviceMismatch } = await import('@/lib/session-device');
    const _headers = await headers();
    const currentDeviceHash = generateDeviceHash(_headers);
    const sessionVendor = secureLink.VendorAccess.find((v) => v.activeSessionId === sessionId);
    if (isSessionDeviceMismatch(sessionVendor?.activeDeviceHash, currentDeviceHash)) {
      return { success: false, status: 403, error: DEVICE_MISMATCH_ERROR };
    }
  }

  if (fileId) {
    const fileBelongsToLink = secureLink.UserFile.some((file) => file.id === fileId);
    if (!fileBelongsToLink) {
      return { success: false, status: 404, error: 'File not found for this link' };
    }
  }

  const capabilities = resolveCapabilities(secureLink, isAuthorized, isOwner);

  // Per-file edit lock (in addition to link-level allowEditing)
  if (action === 'edit' && fileId) {
    const target = secureLink.UserFile.find((f) => f.id === fileId);
    if (target?.editingLocked) {
      return { success: false, status: 403, error: 'Forbidden: File editing is locked' };
    }
  }

  if (action === 'edit' && !capabilities.canEdit) {
    return { success: false, status: 403, error: 'Forbidden: Edit access denied' };
  }
  if (action === 'preview' && !capabilities.canPreview) {
    return { success: false, status: 403, error: 'Forbidden: Preview access denied' };
  }
  if (action === 'download' && !capabilities.canDownload) {
    return { success: false, status: 403, error: 'Forbidden: Download access denied' };
  }
  if (action === 'comment' && !capabilities.canComment) {
    return { success: false, status: 403, error: 'Forbidden: Comment access denied' };
  }

  return {
    success: true,
    context: {
      secureLink,
      sessionId,
      effectiveEmail,
      isOwner,
      vendorAccess: vendorAccessRecord,
      capabilities,
    },
  };
}
