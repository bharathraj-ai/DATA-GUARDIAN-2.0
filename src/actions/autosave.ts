'use server';

import { prisma } from '@/lib/prisma';
import { auth } from '@/lib/auth';
import { cookies } from 'next/headers';
import { authorizeSecureLink } from '@/lib/linkAuthorization';

export async function autosaveSession(
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

    // Reuse secureLink from authorization result — no extra DB query needed
    const secureLink = authResult.context.secureLink;

    // Look up vendor from the already-loaded VendorAccess array
    const vendorAccess = (secureLink as any).VendorAccess?.find(
      (v: any) => v.email.toLowerCase() === vendorEmail!.toLowerCase()
    );

    if (!vendorAccess) {
      return { success: false, error: 'Vendor access not found' };
    }

    const currentSessionId = cookieStore.get('session_id')?.value;
    
    if (vendorAccess.activeSessionId && currentSessionId && vendorAccess.activeSessionId !== currentSessionId) {
      return { success: false, error: 'Another session is currently active' };
    }

    if (payload.draftVersion < vendorAccess.draftVersion) {
       return { success: false, error: 'Stale autosave request' };
    }

    // Retry mechanism for transient DB connection drops (like ECONNRESET)
    const now = new Date();
    let retries = 3;
    let lastError;
    
    while (retries > 0) {
      try {
        await prisma.vendorAccess.update({
          where: { id: vendorAccess.id },
          data: {
            lastSavedWork: payload.lastSavedWork !== undefined ? payload.lastSavedWork : undefined,
            resumePoint: payload.resumePoint !== undefined ? payload.resumePoint : undefined,
            currentPage: payload.currentPage !== undefined ? payload.currentPage : undefined,
            draftVersion: { increment: 1 },
            lastCommitAt: now,
            lastSeenAt: now
          }
        });
        return { success: true, draftVersion: vendorAccess.draftVersion + 1 };
      } catch (err: any) {
        lastError = err;
        retries--;
        if (retries === 0) throw err;
        // Wait 1 second before retrying
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }

    throw lastError;
  } catch (error) {
    console.error('Autosave error:', error);
    return { success: false, error: 'Failed to autosave' };
  }
}
