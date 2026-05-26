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
      select: { id: true }
    });

    if (!secureLink) {
      return { success: false, error: 'Link not found' };
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

    const now = new Date();
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
        lastSeenAt: now
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
