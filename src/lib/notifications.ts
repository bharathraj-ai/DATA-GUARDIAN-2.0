/**
 * Data Guardian V2.1 - Notification System
 * 
 * Privacy-first notification delivery for access transparency.
 * All notifications are privacy-safe with NO PII in email content.
 */

import { prisma } from './prisma';

// ============================================
// NOTIFICATION EVENT TYPES
// ============================================

export type NotificationEvent =
    | 'ACCESS'           // Link was accessed (OTP verified)
    | 'SESSION_END'      // Data viewing session ended
    | 'EXPIRED'          // Link expired automatically
    | 'REVOKED'          // Link manually revoked by owner
    | 'DEVICE_MISMATCH'  // Anti-phishing: Access from different device
    | 'FAILED_ATTEMPTS'; // Anti-phishing: Multiple OTP failures

interface NotificationPayload {
    email: string;
    event: NotificationEvent;
    tokenId: string;
    timestamp: Date;
    metadata?: {
        sessionDuration?: number;  // in seconds
        purpose?: string;
        expiryTime?: Date;
        failedAttempts?: number;   // for FAILED_ATTEMPTS alerts
    };
}

// ============================================
// EMAIL TEMPLATE GENERATOR
// ============================================

function createEmailTemplate(payload: NotificationPayload): { subject: string; html: string; text: string } {
    const { event, tokenId, timestamp, metadata } = payload;
    const shortTokenId = tokenId.substring(0, 8);
    const formattedTime = timestamp.toLocaleString('en-US', {
        dateStyle: 'medium',
        timeStyle: 'short'
    });

    let subject = '';
    let heading = '';
    let message = '';
    let iconColor = '';

    switch (event) {
        case 'ACCESS':
            subject = '🔓 Data Guardian: Link Accessed';
            heading = 'Your Secure Link Was Accessed';
            message = `Someone accessed your shared data link at ${formattedTime}.`;
            iconColor = '#10b981'; // green
            if (metadata?.purpose) {
                message += `\n\nPurpose: ${metadata.purpose}`;
            }
            break;

        case 'SESSION_END':
            subject = '⏱️ Data Guardian: Session Ended';
            heading = 'Viewing Session Ended';
            const duration = metadata?.sessionDuration
                ? `${Math.floor(metadata.sessionDuration / 60)} minutes`
                : 'unknown duration';
            message = `The data viewing session ended after ${duration}.`;
            iconColor = '#3b82f6'; // blue
            break;

        case 'EXPIRED':
            subject = ' Data Guardian: Link Expired';
            heading = 'Your Secure Link Has Expired';
            message = `Your shared data link expired automatically at ${formattedTime}. All data has been securely deleted.`;
            iconColor = '#6b7280'; // gray
            break;

        case 'REVOKED':
            subject = 'Data Guardian: Link Revoked';
            heading = 'Link Successfully Revoked';
            message = `Your shared link was revoked at ${formattedTime}. Access is now permanently blocked.`;
            iconColor = '#ef4444'; // red
            break;

        case 'DEVICE_MISMATCH':
            subject = '⚠️ Data Guardian: Suspicious Access Attempt';
            heading = 'Device Mismatch Detected';
            message = `Someone attempted to access your secure link from a different device/browser at ${formattedTime}. Access was DENIED for security.`;
            iconColor = '#f59e0b'; // amber/warning
            break;

        case 'FAILED_ATTEMPTS':
            subject = '🚨 Data Guardian: Multiple Failed Attempts';
            heading = 'Multiple OTP Failures Detected';
            const attempts = metadata?.failedAttempts || 'multiple';
            message = `${attempts} failed OTP verification attempts were detected on your secure link at ${formattedTime}. This may indicate a brute-force attack.`;
            iconColor = '#ef4444'; // red
            break;
    }

    // HTML Email Template
    const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${subject}</title>
</head>
<body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; background-color: #f3f4f6;">
  <div style="max-width: 600px; margin: 40px auto; background-color: #ffffff; border-radius: 8px; box-shadow: 0 2px 8px rgba(0,0,0,0.1); overflow: hidden;">
    
    <!-- Header -->
    <div style="background: linear-gradient(135deg, #6366f1 0%, #4f46e5 100%); padding: 32px 24px; text-align: center;">
      <div style="width: 56px; height: 56px; background-color: ${iconColor}; border-radius: 50%; margin: 0 auto 16px; display: flex; align-items: center; justify-content: center; font-size: 28px;">
        🛡️
      </div>
      <h1 style="margin: 0; color: #ffffff; font-size: 24px; font-weight: 600;">${heading}</h1>
    </div>
    
    <!-- Content -->
    <div style="padding: 32px 24px;">
      <p style="margin: 0 0 16px; color: #374151; font-size: 16px; line-height: 1.6;">${message}</p>
      
      <div style="background-color: #f9fafb; border-left: 4px solid ${iconColor}; padding: 16px; margin: 24px 0; border-radius: 4px;">
        <p style="margin: 0; color: #6b7280; font-size: 14px;">
          <strong>Link ID:</strong> ${shortTokenId}...<br>
          <strong>Event Time:</strong> ${formattedTime}
        </p>
      </div>
      
      <p style="margin: 24px 0 0; color: #6b7280; font-size: 14px; line-height: 1.5;">
        <strong>Privacy Notice:</strong> This notification contains no sensitive data. It's sent for transparency and security monitoring.
      </p>
    </div>
    
    <!-- Footer -->
    <div style="background-color: #f9fafb; padding: 24px; border-top: 1px solid #e5e7eb; text-align: center;">
      <p style="margin: 0; color: #9ca3af; font-size: 12px;">
        Data Guardian V2.1 - Enterprise Secure Sharing<br>
        <span style="color: #d1d5db;">•</span> Privacy-First <span style="color: #d1d5db;">•</span> Zero-Trust <span style="color: #d1d5db;">•</span> Audit-Ready
      </p>
    </div>
    
  </div>
</body>
</html>
  `.trim();

    // Plain text version
    const text = `
${heading}

${message}

Link ID: ${shortTokenId}...
Event Time: ${formattedTime}

Privacy Notice: This notification contains no sensitive data. It's sent for transparency and security monitoring.

---
Data Guardian V2.1 - Enterprise Secure Sharing
  `.trim();

    return { subject, html, text };
}

// ============================================
// NOTIFICATION DELIVERY
// ============================================

/**
 * Send access notification to data owner
 * 
 * @param payload - Notification details
 * @returns Success status
 */
export async function sendAccessNotification(payload: NotificationPayload): Promise<boolean> {
    try {
        const { subject, html, text } = createEmailTemplate(payload);

        // TODO: Integrate with email service (Resend, SendGrid, etc.)
        // For now, we'll log the notification and create audit trail

        console.log('📧 Notification:', {
            to: payload.email,
            subject,
            event: payload.event,
            tokenId: payload.tokenId.substring(0, 8)
        });

        // Log notification event in audit trail
        await prisma.auditLog.create({
            data: {
                action: 'NOTIFIED',
                reason: `${payload.event} notification sent`,
                metadata: JSON.stringify({
                    event: payload.event,
                    notificationEmail: payload.email.substring(0, 3) + '***', // Masked
                    timestamp: payload.timestamp.toISOString(),
                    ...payload.metadata
                }),
                linkId: payload.tokenId
            }
        });

        // TODO: Replace with actual email service
        // Example with Resend:
        // const { Resend } = await import('resend');
        // const resend = new Resend(process.env.RESEND_API_KEY);
        // await resend.emails.send({
        //   from: 'Data Guardian <notifications@dataguardian.com>',
        //   to: payload.email,
        //   subject,
        //   html,
        //   text
        // });

        return true;
    } catch (error) {
        console.error('Failed to send notification:', error);
        return false;
    }
}

/**
 * Helper: Send link accessed notification
 */
export async function notifyLinkAccessed(
    email: string,
    tokenId: string,
    purpose?: string
): Promise<void> {
    await sendAccessNotification({
        email,
        event: 'ACCESS',
        tokenId,
        timestamp: new Date(),
        metadata: purpose ? { purpose } : undefined
    });
}

/**
 * Helper: Send session ended notification
 */
export async function notifySessionEnd(
    email: string,
    tokenId: string,
    sessionDuration: number
): Promise<void> {
    await sendAccessNotification({
        email,
        event: 'SESSION_END',
        tokenId,
        timestamp: new Date(),
        metadata: { sessionDuration }
    });
}

/**
 * Helper: Send link expired notification
 */
export async function notifyLinkExpired(
    email: string,
    tokenId: string,
    expiryTime: Date
): Promise<void> {
    await sendAccessNotification({
        email,
        event: 'EXPIRED',
        tokenId,
        timestamp: new Date(),
        metadata: { expiryTime }
    });
}

/**
 * Helper: Send link revoked notification
 */
export async function notifyLinkRevoked(
    email: string,
    tokenId: string
): Promise<void> {
    await sendAccessNotification({
        email,
        event: 'REVOKED',
        tokenId,
        timestamp: new Date()
    });
}

/**
 * Helper: Send device mismatch alert (Anti-Phishing)
 * Notifies owner when someone tries to access from a different device
 */
export async function notifyDeviceMismatch(
    email: string,
    tokenId: string
): Promise<void> {
    await sendAccessNotification({
        email,
        event: 'DEVICE_MISMATCH',
        tokenId,
        timestamp: new Date()
    });
}

/**
 * Helper: Send failed attempts alert (Anti-Phishing)
 * Notifies owner of multiple OTP verification failures
 */
export async function notifyFailedAttempts(
    email: string,
    tokenId: string,
    failedAttempts: number
): Promise<void> {
    await sendAccessNotification({
        email,
        event: 'FAILED_ATTEMPTS',
        tokenId,
        timestamp: new Date(),
        metadata: { failedAttempts }
    });
}

// ============================================
// UTILITY FUNCTIONS
// ============================================

/**
 * Check if notifications are enabled for a link
 */
export async function isNotificationEnabled(tokenId: string): Promise<boolean> {
    const link = await prisma.secureLink.findUnique({
        where: { id: tokenId },
        select: { notificationEmail: true }
    });

    return !!link?.notificationEmail;
}

/**
 * Get notification email for a link
 */
export async function getNotificationEmail(tokenId: string): Promise<string | null> {
    const link = await prisma.secureLink.findUnique({
        where: { id: tokenId },
        select: { notificationEmail: true }
    });

    return link?.notificationEmail || null;
}
