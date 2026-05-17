import { cookies } from 'next/headers';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { tryCheckRevoked, tryValidateSession } from '@/lib/redis-helpers';
import { Prisma } from '@prisma/client';

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
  include: {
    User: { select: { id: true, email: true } },
    VendorAccess: true,
    LinkAccess: true,
    UserFile: true,
  }
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
  const canPreview = isAuthorized || isOwner;
  const canEdit = (secureLink.allowEditing || false) && (isAuthorized || isOwner);
  const canComment = isAuthorized || isOwner;
  const canDownload = isAuthorized || isOwner;

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
  const sessionId = cookieStore.get('session_id')?.value;
  if (!sessionId) {
    return { success: false, status: 401, error: 'Unauthorized: Missing session' };
  }

  try {
    const revoked = await tryCheckRevoked(token);
    // null = Redis unavailable → fall through to DB check (secureLink.isRevoked below)
    // true = Redis confirms revoked → block immediately
    if (revoked === true) {
      console.warn('[SECURITY] Access blocked: token confirmed revoked in Redis');
      return { success: false, status: 403, error: 'Forbidden: Access revoked' };
    }

    const validSession = await tryValidateSession(token, sessionId);
    // null = Redis unavailable → fall through to DB-level auth checks below
    // false = Redis confirms session invalid → block immediately
    // Only proceed if Redis confirms valid (true) OR Redis is unavailable (null)
    if (validSession === false) {
      console.warn('[SECURITY] Access blocked: session explicitly invalid in Redis');
      return { success: false, status: 401, error: 'Unauthorized: Session invalid or expired' };
    }
  } catch (err) {
    console.error('[SECURITY] Exception during session validation:', err);
    return { success: false, status: 401, error: 'Authentication infrastructure unavailable' };
  }

  const secureLink = await prisma.secureLink.findUnique({
    where: { token },
    include: {
      User: { select: { id: true, email: true } },
      VendorAccess: true,
      LinkAccess: true,
      UserFile: true,
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
  const cookieEmail = normalizeEmail(cookieStore.get('vendor_email')?.value);
  const effectiveEmail = cookieEmail || sessionEmail;
  const isOwner = authSession?.user?.id !== undefined && authSession.user.id === secureLink.ownerId;

  const hasEmailGate =
    Boolean(secureLink.allowedVendorEmail) ||
    secureLink.LinkAccess.length > 0 ||
    secureLink.VendorAccess.length > 0;

  let vendorAccessRecord: { level: number; isRevoked: boolean } | null = null;
  let isAuthorized = false;
  let effectiveIsUsed = secureLink.isUsed; // Track effective isUsed for the user

  if (isOwner) {
    isAuthorized = true;
    effectiveIsUsed = true; // Owners don't need OTP
  } else if (!hasEmailGate) {
    isAuthorized = true;
  } else if (effectiveEmail) {
    const normalized = normalizeEmail(effectiveEmail)!;

    if (secureLink.allowedVendorEmail && normalizeEmail(secureLink.allowedVendorEmail) === normalized) {
      isAuthorized = true;
    }

    const linkAccess = secureLink.LinkAccess.find(
      (access) => normalizeEmail(access.vendorEmail) === normalized && !access.lockedAt,
    );
    if (linkAccess) {
      vendorAccessRecord = { level: linkAccess.level, isRevoked: false };
      effectiveIsUsed = linkAccess.isUsed; // Use LinkAccess isUsed
      isAuthorized = true;
    }

    const vendor = secureLink.VendorAccess.find(
      (access) => normalizeEmail(access.email) === normalized && !access.isRevoked,
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

  if (fileId) {
    const fileBelongsToLink = secureLink.UserFile.some((file) => file.id === fileId);
    if (!fileBelongsToLink) {
      return { success: false, status: 404, error: 'File not found for this link' };
    }
  }

  const capabilities = resolveCapabilities(secureLink, isAuthorized, isOwner);

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
