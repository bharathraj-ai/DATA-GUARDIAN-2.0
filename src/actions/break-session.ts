'use server';

import { prisma } from '@/lib/prisma';
import { auth } from '@/lib/auth';
import { cookies } from 'next/headers';
import { authorizeSecureLink } from '@/lib/linkAuthorization';

export async function takeBreak(
  token: string, 
  payload: {
    lastSavedWork?: any;
    resumePoint?: any;
    currentPage?: number;
    draftVersion: number;
  }
) {
  try {
    const authResult = await authorizeSecureLink(token, 'view');
    if (!authResult.success) {
      return { success: false, error: authResult.error };
    }

    const session = await auth();
    let vendorEmail = session?.user?.email;
    const cookieStore = await cookies();
    if (!vendorEmail) {
      vendorEmail = cookieStore.get('vendor_email')?.value;
    }

    if (!vendorEmail) {
      return { success: false, error: 'Unauthorized vendor session' };
    }

    const secureLink = await prisma.secureLink.findUnique({
      where: { token },
      select: { id: true, allowDownload: true, expiresAt: true }
    });

    if (!secureLink) {
      return { success: false, error: 'Link not found' };
    }

    // Download Override: If downloads are allowed, taking a break just revokes access.
    if (secureLink.allowDownload) {
      await prisma.secureLink.update({
        where: { id: secureLink.id },
        data: { isRevoked: true }
      });
      
      await prisma.auditLog.create({
        data: {
          action: 'BREAK',
          linkId: secureLink.id,
          reason: 'Vendor closed session (Download only mode)',
          metadata: JSON.stringify({ vendorEmail, action: 'revoke_on_break' })
        }
      });
      
      cookieStore.delete('session_id');
      cookieStore.delete('vendor_email');
      return { success: true, message: 'Access revoked' };
    }

    const vendorAccess = await prisma.vendorAccess.findUnique({
      where: {
        secureLinkId_email: {
          secureLinkId: secureLink.id,
          email: vendorEmail
        }
      }
    });

    if (!vendorAccess) {
      return { success: false, error: 'Vendor access not found' };
    }

    // Enforce Break Limits
    if (vendorAccess.breaksUsed >= vendorAccess.allowedBreaks) {
      await prisma.auditLog.create({
        data: {
          action: 'BREAK_LIMIT_EXCEEDED',
          linkId: secureLink.id,
          reason: 'Vendor attempted to take a break but reached the allowed limit.',
          metadata: JSON.stringify({ vendorEmail, breaksUsed: vendorAccess.breaksUsed, allowedBreaks: vendorAccess.allowedBreaks })
        }
      });
      return { success: false, error: 'Maximum break limit reached' };
    }

    const now = new Date();
    
    // OTP Rotation: Archive current OTP securely
    if (vendorAccess.currentOtpHash && vendorAccess.currentOtpCreatedAt) {
      await prisma.otpHistory.create({
        data: {
          SecureLink: { connect: { id: secureLink.id } },
          vendorEmail: vendorEmail,
          otpHash: vendorAccess.currentOtpHash,
          createdAt: vendorAccess.currentOtpCreatedAt,
          invalidatedAt: now,
          reason: 'BREAK_STARTED',
          status: 'INVALIDATED'
        }
      });
    }

    // Generate New OTP
    const { generateOTP, hashOTP } = await import('@/lib/crypto');
    const { sendOTPEmail } = await import('@/lib/email');
    const newOtp = generateOTP();
    const newOtpHash = await hashOTP(newOtp);

    await prisma.vendorAccess.update({
      where: { id: vendorAccess.id },
      data: {
        ...(payload.draftVersion >= vendorAccess.draftVersion ? {
           lastSavedWork: payload.lastSavedWork !== undefined ? payload.lastSavedWork : undefined,
           resumePoint: payload.resumePoint !== undefined ? payload.resumePoint : undefined,
           currentPage: payload.currentPage !== undefined ? payload.currentPage : undefined,
           draftVersion: { increment: 1 },
           lastCommitAt: now,
        } : {}),
        status: 'break',
        breakStartedAt: now,
        activeSessionId: null, // Clear active session
        lastSeenAt: now,
        // OTP Rotation Fields
        breaksUsed: { increment: 1 },
        currentOtpHash: newOtpHash,
        currentOtpCreatedAt: now,
      }
    });

    // Send the new OTP email to the vendor
    const remainingMinutes = Math.max(1, Math.floor((secureLink.expiresAt.getTime() - now.getTime()) / 60000));
    await sendOTPEmail(vendorEmail, token, newOtp, remainingMinutes).catch(err => {
      console.error('Failed to send rotation OTP email:', err);
    });

    // Log the BREAK and ROTATION actions
    await prisma.auditLog.create({
      data: {
        action: 'BREAK',
        linkId: secureLink.id,
        reason: 'Vendor paused session',
        metadata: JSON.stringify({ vendorEmail, action: 'break' })
      }
    });

    await prisma.auditLog.create({
      data: {
        action: 'OTP_ROTATED',
        linkId: secureLink.id,
        reason: 'Generated new OTP for vendor break',
        metadata: JSON.stringify({ vendorEmail, breaksUsed: vendorAccess.breaksUsed + 1 })
      }
    });

    cookieStore.delete('session_id');
    cookieStore.delete('vendor_email');

    return { success: true };
  } catch (error) {
    console.error('Break session error:', error);
    return { success: false, error: 'Failed to take break' };
  }
}
