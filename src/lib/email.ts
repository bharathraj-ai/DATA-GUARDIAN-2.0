import nodemailer from 'nodemailer';
import type Transporter from 'nodemailer/lib/mailer';

// ============================================
// SMTP TRANSPORTER (serverless-safe)
// ============================================

const SMTP_SEND_TIMEOUT_MS = 20_000;

function readEmailEnv() {
    const user = (process.env.EMAIL_USER || process.env.SMTP_USER || '').trim();
    const pass = (process.env.EMAIL_PASS || process.env.SMTP_PASS || '').trim();
    const host = (process.env.SMTP_HOST || 'smtp.gmail.com').trim();
    const port = Number(process.env.SMTP_PORT || 465);
    const secure = port === 465;
    const from =
        (process.env.EMAIL_FROM || process.env.EMAIL_USER || process.env.SMTP_USER || user).trim();

    return { user, pass, host, port, secure, from };
}

export function isEmailConfigured(): boolean {
    const { user, pass } = readEmailEnv();
    return Boolean(user && pass);
}

let transporter: Transporter | null = null;

function getTransporter(): Transporter {
    if (transporter) return transporter;

    const { user, pass, host, port, secure } = readEmailEnv();
    if (!user || !pass) {
        throw new Error(
            'Email is not configured. Set EMAIL_USER + EMAIL_PASS (or SMTP_USER + SMTP_PASS) on Vercel.',
        );
    }

    transporter = nodemailer.createTransport({
        host,
        port,
        secure,
        // Vercel/Railway: avoid IPv6 SMTP hangs to Gmail
        family: 4,
        connectionTimeout: 10_000,
        greetingTimeout: 10_000,
        socketTimeout: 15_000,
        auth: { user, pass },
    } as nodemailer.TransportOptions);

    return transporter;
}

async function sendWithTimeout<T>(promise: Promise<T>, label: string): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
        return await Promise.race([
            promise,
            new Promise<T>((_, reject) => {
                timer = setTimeout(
                    () => reject(new Error(`${label} timed out after ${SMTP_SEND_TIMEOUT_MS}ms`)),
                    SMTP_SEND_TIMEOUT_MS,
                );
            }),
        ]);
    } finally {
        if (timer) clearTimeout(timer);
    }
}

// ============================================
// OTP EMAIL DELIVERY
// ============================================

/**
 * Sends a secure OTP email to the vendor with the share link and OTP code.
 */
export async function sendOTPEmail(
    vendorEmail: string,
    token: string,
    otp: string,
    expiresMinutes: number,
): Promise<void> {
    const appUrl =
        process.env.APP_URL ||
        process.env.NEXT_PUBLIC_BASE_URL ||
        'http://localhost:3000';
    const shareLink = `${appUrl}/share/${token}`;
    const senderName = process.env.EMAIL_FROM_NAME || 'Data Guardian Security';
    const { from, user } = readEmailEnv();

    await sendWithTimeout(
        getTransporter().sendMail({
            from: `"${senderName}" <${from || user}>`,
            to: vendorEmail,
            subject: '🔐 Secure Data Access - OTP Verification',
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
    <div style="background: linear-gradient(135deg, #111827 0%, #1f2937 100%); padding: 32px 24px; text-align: center;">
      <div style="width: 56px; height: 56px; background-color: #ffffff; border-radius: 50%; margin: 0 auto 16px; display: flex; align-items: center; justify-content: center; font-size: 28px;">🛡️</div>
      <h1 style="margin: 0; color: #ffffff; font-size: 24px; font-weight: 600;">Secure Access Notification</h1>
    </div>
    <div style="padding: 32px 24px;">
      <p style="margin: 0 0 24px; color: #374151; font-size: 16px; line-height: 1.6;">You have been granted temporary access to secure data.</p>
      <div style="background-color: #f9fafb; border-left: 4px solid #6366f1; padding: 16px; margin: 0 0 24px; border-radius: 4px;">
        <p style="margin: 0 0 8px; color: #6b7280; font-size: 13px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.05em;">Secure Link</p>
        <a href="${shareLink}" style="color: #4f46e5; word-break: break-all; font-size: 14px;">${shareLink}</a>
      </div>
      <div style="background-color: #111827; border-radius: 8px; padding: 24px; text-align: center; margin: 0 0 24px;">
        <p style="margin: 0 0 8px; color: #9ca3af; font-size: 13px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.1em;">Your One-Time Password</p>
        <p style="margin: 0; color: #ffffff; font-size: 36px; font-weight: 700; letter-spacing: 8px; font-family: 'Courier New', monospace;">${otp}</p>
      </div>
      <div style="background-color: #fef3c7; border-left: 4px solid #f59e0b; padding: 16px; margin: 0 0 24px; border-radius: 4px;">
        <p style="margin: 0; color: #92400e; font-size: 14px;">⏱️ This OTP is valid for <strong>${expiresMinutes} minutes</strong>.</p>
      </div>
      <div style="background-color: #fef2f2; border-left: 4px solid #ef4444; padding: 16px; margin: 0; border-radius: 4px;">
        <p style="margin: 0; color: #991b1b; font-size: 14px;">🚨 <strong>Security Warning:</strong> Do NOT share this OTP with anyone.</p>
      </div>
    </div>
    <div style="background-color: #f9fafb; padding: 24px; border-top: 1px solid #e5e7eb; text-align: center;">
      <p style="margin: 0; color: #9ca3af; font-size: 12px;">Data Guardian Security System</p>
    </div>
  </div>
</body>
</html>
            `.trim(),
        }),
        'OTP email',
    );
}

// ============================================
// COMPLETED WORK EMAIL WITH ATTACHMENT
// ============================================

export interface FileAttachment {
    filename: string;
    content: Buffer;
    contentType: string;
}

export async function sendCompletedWorkEmail(
    ownerEmail: string,
    vendorEmail: string,
    purpose: string,
    attachments: FileAttachment[],
): Promise<void> {
    const senderName = process.env.EMAIL_FROM_NAME || 'Data Guardian Security';
    const fileList = attachments.map((a) => `• ${a.filename}`).join('<br>');
    const fileCount = attachments.length;
    const { from, user } = readEmailEnv();

    await sendWithTimeout(
        getTransporter().sendMail({
            from: `"${senderName}" <${from || user}>`,
            to: ownerEmail,
            subject: `✅ Data Guardian: Completed Work Delivered (${fileCount} file${fileCount > 1 ? 's' : ''})`,
            html: `<p>Work completed by ${vendorEmail}. Files attached: ${fileCount}</p><p>${fileList}</p>`,
            text: `Work Completed & Delivered\n\nVendor: ${vendorEmail}\nPurpose: ${purpose || 'N/A'}\nFiles: ${fileCount}`,
            attachments: attachments.map((a) => ({
                filename: a.filename,
                content: a.content,
                contentType: a.contentType,
            })),
        }),
        'Completed work email',
    );
}

// ============================================
// GENERIC NOTIFICATION EMAIL SENDER
// ============================================

export async function sendNotificationEmail(
    to: string,
    subject: string,
    html: string,
    text: string,
): Promise<void> {
    const senderName = process.env.EMAIL_FROM_NAME || 'Data Guardian Security';
    const { from, user } = readEmailEnv();

    await sendWithTimeout(
        getTransporter().sendMail({
            from: `"${senderName}" <${from || user}>`,
            to,
            subject,
            html,
            text,
        }),
        'Notification email',
    );
}
