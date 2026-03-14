import nodemailer from "nodemailer";

// ============================================
// GMAIL SMTP TRANSPORTER
// ============================================

const transporter = nodemailer.createTransport({
    service: "gmail",
    auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS,
    },
});

// ============================================
// OTP EMAIL DELIVERY
// ============================================

/**
 * Sends a secure OTP email to the vendor with the share link and OTP code.
 * 
 * The email includes:
 * - The secure share link
 * - The one-time OTP code
 * - Expiry information
 * - Security warnings
 */
export async function sendOTPEmail(
    vendorEmail: string,
    token: string,
    otp: string,
    expiresMinutes: number
): Promise<void> {
    const appUrl = process.env.APP_URL || process.env.NEXT_PUBLIC_BASE_URL || "http://localhost:3000";
    const shareLink = `${appUrl}/share/${token}`;
    const senderName = process.env.EMAIL_FROM_NAME || "Data Guardian Security";

    await transporter.sendMail({
        from: `"${senderName}" <${process.env.EMAIL_USER}>`,
        to: vendorEmail,
        subject: "🔐 Secure Data Access - OTP Verification",
        html: `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Secure Data Access</title>
</head>
<body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; background-color: #f3f4f6;">
  <div style="max-width: 600px; margin: 40px auto; background-color: #ffffff; border-radius: 8px; box-shadow: 0 2px 8px rgba(0,0,0,0.1); overflow: hidden;">
    
    <!-- Header -->
    <div style="background: linear-gradient(135deg, #111827 0%, #1f2937 100%); padding: 32px 24px; text-align: center;">
      <div style="width: 56px; height: 56px; background-color: #ffffff; border-radius: 50%; margin: 0 auto 16px; display: flex; align-items: center; justify-content: center; font-size: 28px;">
        🛡️
      </div>
      <h1 style="margin: 0; color: #ffffff; font-size: 24px; font-weight: 600;">Secure Access Notification</h1>
    </div>
    
    <!-- Content -->
    <div style="padding: 32px 24px;">
      <p style="margin: 0 0 24px; color: #374151; font-size: 16px; line-height: 1.6;">
        You have been granted temporary access to secure data.
      </p>

      <!-- Share Link -->
      <div style="background-color: #f9fafb; border-left: 4px solid #6366f1; padding: 16px; margin: 0 0 24px; border-radius: 4px;">
        <p style="margin: 0 0 8px; color: #6b7280; font-size: 13px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.05em;">Secure Link</p>
        <a href="${shareLink}" style="color: #4f46e5; word-break: break-all; font-size: 14px;">${shareLink}</a>
      </div>

      <!-- OTP Code -->
      <div style="background-color: #111827; border-radius: 8px; padding: 24px; text-align: center; margin: 0 0 24px;">
        <p style="margin: 0 0 8px; color: #9ca3af; font-size: 13px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.1em;">Your One-Time Password</p>
        <p style="margin: 0; color: #ffffff; font-size: 36px; font-weight: 700; letter-spacing: 8px; font-family: 'Courier New', monospace;">${otp}</p>
      </div>

      <!-- Expiry -->
      <div style="background-color: #fef3c7; border-left: 4px solid #f59e0b; padding: 16px; margin: 0 0 24px; border-radius: 4px;">
        <p style="margin: 0; color: #92400e; font-size: 14px;">
          ⏱️ This OTP is valid for <strong>${expiresMinutes} minutes</strong>. After expiry, the link and data will be permanently deleted.
        </p>
      </div>

      <!-- Security Warning -->
      <div style="background-color: #fef2f2; border-left: 4px solid #ef4444; padding: 16px; margin: 0; border-radius: 4px;">
        <p style="margin: 0; color: #991b1b; font-size: 14px;">
          🚨 <strong>Security Warning:</strong> Do NOT share this OTP with anyone. You have only <strong>one attempt</strong> — entering a wrong OTP will permanently revoke the link.
        </p>
      </div>
    </div>
    
    <!-- Footer -->
    <div style="background-color: #f9fafb; padding: 24px; border-top: 1px solid #e5e7eb; text-align: center;">
      <p style="margin: 0; color: #9ca3af; font-size: 12px;">
        Data Guardian Security System<br>
        <span style="color: #d1d5db;">•</span> Privacy-First <span style="color: #d1d5db;">•</span> Zero-Trust <span style="color: #d1d5db;">•</span> Audit-Ready
      </p>
    </div>
    
  </div>
</body>
</html>
    `.trim(),
    });
}

// ============================================
// GENERIC NOTIFICATION EMAIL SENDER
// ============================================

/**
 * Sends an arbitrary notification email with pre-built subject/html/text.
 * Used by the notifications system to deliver security alerts.
 */
export async function sendNotificationEmail(
    to: string,
    subject: string,
    html: string,
    text: string
): Promise<void> {
    const senderName = process.env.EMAIL_FROM_NAME || "Data Guardian Security";

    await transporter.sendMail({
        from: `"${senderName}" <${process.env.EMAIL_USER}>`,
        to,
        subject,
        html,
        text,
    });
}
