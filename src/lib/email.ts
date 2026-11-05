import nodemailer from 'nodemailer';
import type Transporter from 'nodemailer/lib/mailer';
import { logger, redactEmail } from '@/lib/logger';

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
let warming: Promise<void> | null = null;

export function _resetTransporterForTesting(): void {
    transporter = null;
    warming = null;
}

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

/** Open the SMTP TLS session while the owner is still filling the form / uploading files. */
export function warmEmailTransport(): void {
    if (!isEmailConfigured() || warming) return;
    try {
        const t = getTransporter();
        warming = t.verify().then(
            () => undefined,
            () => undefined,
        );
    } catch {
        warming = null;
    }
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

const EMAIL_FONT =
    "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif";

function escapeHtml(value: string): string {
    return value
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function formatOtpDisplay(otp: string): string {
    return otp
        .replace(/\s+/g, '')
        .split('')
        .map((d) => escapeHtml(d))
        .join('&nbsp;');
}

function formatValidity(minutes: number): string {
    if (!Number.isFinite(minutes) || minutes <= 0) return 'a limited time';
    if (minutes >= 1440) {
        const days = Math.round(minutes / 1440);
        return days === 1 ? '1 day' : `${days} days`;
    }
    if (minutes >= 60) {
        const hours = Math.round(minutes / 60);
        return hours === 1 ? '1 hour' : `${hours} hours`;
    }
    return minutes === 1 ? '1 minute' : `${minutes} minutes`;
}

function emailShell(opts: {
    title: string;
    subtitle: string;
    preheader?: string;
    bodyHtml: string;
}): string {
    const preheader = opts.preheader
        ? `<div style="display:none;max-height:0;overflow:hidden;mso-hide:all;">${escapeHtml(opts.preheader)}</div>`
        : '';

    return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(opts.title)}</title>
</head>
<body style="margin:0;padding:0;background-color:#f4f7fb;font-family:${EMAIL_FONT};">
  ${preheader}
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f4f7fb;padding:32px 12px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:16px;overflow:hidden;border:1px solid #e5e7eb;">
          <tr>
            <td style="background-color:#0284c7;background:linear-gradient(135deg,#0284c7 0%,#0369a1 100%);padding:36px 28px;text-align:center;">
              <table role="presentation" cellpadding="0" cellspacing="0" align="center" style="margin:0 auto 16px;">
                <tr>
                  <td align="center" valign="middle" style="width:48px;height:48px;background:rgba(255,255,255,0.16);border:1px solid rgba(255,255,255,0.35);border-radius:12px;color:#ffffff;font-size:15px;font-weight:800;letter-spacing:0.04em;">DG</td>
                </tr>
              </table>
              <h1 style="margin:0 0 6px;color:#ffffff;font-size:22px;font-weight:700;letter-spacing:-0.02em;">${escapeHtml(opts.title)}</h1>
              <p style="margin:0;color:#e0f2fe;font-size:13px;font-weight:500;">${escapeHtml(opts.subtitle)}</p>
            </td>
          </tr>
          <tr>
            <td style="padding:32px 28px;">${opts.bodyHtml}</td>
          </tr>
          <tr>
            <td style="background:#f8fafc;padding:20px 28px;border-top:1px solid #e5e7eb;text-align:center;">
              <p style="margin:0;color:#94a3b8;font-size:12px;">Data Guardian · AES-256 · OTP protected</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`.trim();
}

// ============================================
// OTP EMAIL DELIVERY
// ============================================

export interface SendEmailRetryOptions {
    maxRetries?: number;
    initialDelayMs?: number;
    backoffFactor?: number;
}

async function sendOTPEmailSingleAttempt(
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
    const validity = formatValidity(expiresMinutes);
    const otpDisplay = formatOtpDisplay(otp);
    const safeLink = escapeHtml(shareLink);

    const bodyHtml = `
      <p style="margin:0 0 24px;color:#475569;font-size:15px;line-height:1.6;">You have been granted temporary access to secure data.</p>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 20px;">
        <tr>
          <td align="center" style="background:#0284c7;border-radius:10px;">
            <a href="${safeLink}" style="display:inline-block;padding:14px 22px;color:#ffffff;font-size:15px;font-weight:700;text-decoration:none;letter-spacing:-0.01em;">Open Secure Link</a>
          </td>
        </tr>
      </table>
      <p style="margin:0 0 24px;color:#94a3b8;font-size:12px;line-height:1.5;word-break:break-all;">${safeLink}</p>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 20px;">
        <tr>
          <td style="background:#f0f9ff;border:1px solid #bae6fd;border-radius:14px;padding:22px 18px;text-align:center;">
            <p style="margin:0 0 10px;color:#0284c7;font-size:11px;font-weight:700;letter-spacing:0.12em;text-transform:uppercase;">One-Time Password</p>
            <table role="presentation" cellpadding="0" cellspacing="0" align="center" style="margin:0 auto;">
              <tr>
                <td nowrap="nowrap" align="center" style="white-space:nowrap;color:#0f172a;font-size:26px;font-weight:800;letter-spacing:3px;font-family:'Courier New',Consolas,monospace;line-height:1.2;">${otpDisplay}</td>
              </tr>
            </table>
          </td>
        </tr>
      </table>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 12px;">
        <tr>
          <td style="background:#fffbeb;border:1px solid #fde68a;border-radius:10px;padding:12px 14px;color:#92400e;font-size:13px;">
            This OTP is valid for <strong>${escapeHtml(validity)}</strong>.
          </td>
        </tr>
      </table>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
        <tr>
          <td style="background:#fef2f2;border:1px solid #fecaca;border-radius:10px;padding:12px 14px;color:#991b1b;font-size:13px;">
            Do not share this OTP with anyone.
          </td>
        </tr>
      </table>
    `;

    await sendWithTimeout(
        getTransporter().sendMail({
            from: `"${senderName}" <${from || user}>`,
            to: vendorEmail,
            subject: 'Data Guardian: Secure access OTP',
            text: `You have been granted temporary access to secure data.\n\nOTP: ${otp}\nValid for ${validity}.\nDo not share this OTP with anyone.`,
            html: emailShell({
                title: 'Secure Access',
                subtitle: 'Temporary encrypted share',
                preheader: `Your OTP is ${otp}. Valid for ${validity}.`,
                bodyHtml,
            }),
        }),
        'OTP email',
    );
}

/**
 * Reliable OTP email delivery with exponential backoff (DL-05).
 * Retries on transient timeouts or SMTP errors, never logs plaintext OTP.
 */
export async function sendOTPEmailWithRetry(
    vendorEmail: string,
    token: string,
    otp: string,
    expiresMinutes: number,
    options?: SendEmailRetryOptions
): Promise<void> {
    const maxRetries = options?.maxRetries ?? 2;
    const initialDelayMs = options?.initialDelayMs ?? 200;
    const backoffFactor = options?.backoffFactor ?? 2;

    let lastError: unknown;
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
            await sendOTPEmailSingleAttempt(vendorEmail, token, otp, expiresMinutes);
            return;
        } catch (err) {
            lastError = err;
            if (attempt < maxRetries) {
                const delay = initialDelayMs * Math.pow(backoffFactor, attempt);
                logger.warn(
                    `[EMAIL] OTP send attempt ${attempt + 1}/${maxRetries + 1} failed for ${redactEmail(vendorEmail)}, retrying in ${delay}ms...`,
                    err instanceof Error ? err.message : 'Unknown error'
                );
                await new Promise((resolve) => setTimeout(resolve, delay));
            }
        }
    }
    throw lastError;
}

/**
 * Sends a secure OTP email with automatic retry and backoff (DL-05).
 */
export async function sendOTPEmail(
    vendorEmail: string,
    token: string,
    otp: string,
    expiresMinutes: number,
    options?: SendEmailRetryOptions,
): Promise<void> {
    return sendOTPEmailWithRetry(vendorEmail, token, otp, expiresMinutes, options);
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
    const fileCount = attachments.length;
    const { from, user } = readEmailEnv();
    const safeVendor = escapeHtml(vendorEmail);
    const safePurpose = purpose ? escapeHtml(purpose) : '';
    const fileRows = attachments
        .map(
            (a) =>
                `<tr><td style="padding:8px 0;color:#0f172a;font-size:14px;border-bottom:1px solid #e0f2fe;">${escapeHtml(a.filename)}</td></tr>`,
        )
        .join('');

    const bodyHtml = `
      <p style="margin:0 0 8px;color:#475569;font-size:15px;line-height:1.6;">Completed work was delivered by <strong style="color:#0f172a;">${safeVendor}</strong>.</p>
      ${
          safePurpose
              ? `<p style="margin:0 0 20px;color:#64748b;font-size:13px;">Purpose: ${safePurpose}</p>`
              : '<div style="height:12px;"></div>'
      }
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 20px;">
        <tr>
          <td style="background:#f0f9ff;border:1px solid #bae6fd;border-radius:14px;padding:18px 18px 10px;">
            <p style="margin:0 0 10px;color:#0284c7;font-size:11px;font-weight:700;letter-spacing:0.12em;text-transform:uppercase;">${fileCount} file${fileCount === 1 ? '' : 's'} attached</p>
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0">${fileRows}</table>
          </td>
        </tr>
      </table>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
        <tr>
          <td style="background:#ecfdf5;border:1px solid #a7f3d0;border-radius:10px;padding:12px 14px;color:#047857;font-size:13px;">
            Files are attached to this email. Download them only from this message.
          </td>
        </tr>
      </table>
    `;

    await sendWithTimeout(
        getTransporter().sendMail({
            from: `"${senderName}" <${from || user}>`,
            to: ownerEmail,
            subject: `Data Guardian: Work delivered (${fileCount} file${fileCount === 1 ? '' : 's'})`,
            text: `Work completed & delivered\n\nVendor: ${vendorEmail}\nPurpose: ${purpose || 'N/A'}\nFiles (${fileCount}):\n${attachments.map((a) => `- ${a.filename}`).join('\n')}\n\nFiles are attached to this email.`,
            html: emailShell({
                title: 'Work Delivered',
                subtitle: 'Completed files from your vendor',
                preheader: `${fileCount} file${fileCount === 1 ? '' : 's'} delivered by ${vendorEmail}.`,
                bodyHtml,
            }),
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

// ============================================
// AUTHENTICATION EMAILS
// ============================================

export async function sendVerificationEmail(
    email: string,
    token: string,
    name?: string,
): Promise<void> {
    if (!isEmailConfigured()) {
        logger.warn(`[Email] SMTP not configured. Verification token for ${redactEmail(email)}: ${token}`);
        return;
    }

    const appUrl = process.env.APP_URL || process.env.NEXT_PUBLIC_BASE_URL || process.env.NEXTAUTH_URL || 'http://localhost:3000';
    const verificationLink = `${appUrl}/auth/verify-email?token=${encodeURIComponent(token)}`;
    const senderName = process.env.EMAIL_FROM_NAME || 'Data Guardian Security';
    const { from, user } = readEmailEnv();
    const safeLink = escapeHtml(verificationLink);
    const displayName = name ? escapeHtml(name) : 'there';

    const bodyHtml = `
      <p style="margin:0 0 16px;color:#334155;font-size:15px;line-height:1.6;">
        Hello ${displayName},
      </p>
      <p style="margin:0 0 24px;color:#475569;font-size:14px;line-height:1.6;">
        Thank you for creating an account on <strong>Data Guardian</strong>. Please click the button below to verify your email address and activate your account.
      </p>
      <table role="presentation" cellpadding="0" cellspacing="0" style="margin:28px 0;">
        <tr>
          <td align="center" style="border-radius:12px;background:#0284c7;">
            <a href="${safeLink}" target="_blank" style="display:inline-block;padding:14px 28px;font-size:15px;font-weight:700;color:#ffffff;text-decoration:none;border-radius:12px;background:#0284c7;letter-spacing:0.02em;">
              Verify Email Address
            </a>
          </td>
        </tr>
      </table>
      <p style="margin:0 0 12px;color:#64748b;font-size:13px;line-height:1.5;">
        Or copy and paste this link into your browser:
      </p>
      <p style="margin:0 0 24px;font-size:12px;word-break:break-all;color:#0284c7;">
        <a href="${safeLink}" style="color:#0284c7;">${safeLink}</a>
      </p>
      <p style="margin:0;padding-top:16px;border-top:1px solid #e2e8f0;color:#94a3b8;font-size:12px;line-height:1.5;">
        This link expires in 24 hours. If you did not create an account, you can safely ignore this email.
      </p>
    `;

    await sendWithTimeout(
        getTransporter().sendMail({
            from: `"${senderName}" <${from || user}>`,
            to: email,
            subject: 'Verify your email address - Data Guardian',
            text: `Hello ${displayName},\n\nPlease verify your email address for Data Guardian by opening this link:\n\n${verificationLink}\n\nThis link expires in 24 hours.`,
            html: emailShell({
                title: 'Verify Your Email',
                subtitle: 'Data Guardian Account Activation',
                preheader: 'Please verify your email address to activate your account.',
                bodyHtml,
            }),
        }),
        'Verification email',
    );
}

export async function sendPasswordResetEmail(
    email: string,
    token: string,
): Promise<void> {
    if (!isEmailConfigured()) {
        logger.warn(`[Email] SMTP not configured. Password reset token for ${redactEmail(email)}: ${token}`);
        return;
    }

    const appUrl = process.env.APP_URL || process.env.NEXT_PUBLIC_BASE_URL || process.env.NEXTAUTH_URL || 'http://localhost:3000';
    const resetLink = `${appUrl}/auth/reset-password?token=${encodeURIComponent(token)}`;
    const senderName = process.env.EMAIL_FROM_NAME || 'Data Guardian Security';
    const { from, user } = readEmailEnv();
    const safeLink = escapeHtml(resetLink);

    const bodyHtml = `
      <p style="margin:0 0 16px;color:#334155;font-size:15px;line-height:1.6;">
        Hello,
      </p>
      <p style="margin:0 0 24px;color:#475569;font-size:14px;line-height:1.6;">
        We received a request to reset the password for your Data Guardian account. Click the button below to choose a new password.
      </p>
      <table role="presentation" cellpadding="0" cellspacing="0" style="margin:28px 0;">
        <tr>
          <td align="center" style="border-radius:12px;background:#0284c7;">
            <a href="${safeLink}" target="_blank" style="display:inline-block;padding:14px 28px;font-size:15px;font-weight:700;color:#ffffff;text-decoration:none;border-radius:12px;background:#0284c7;letter-spacing:0.02em;">
              Reset Password
            </a>
          </td>
        </tr>
      </table>
      <p style="margin:0 0 12px;color:#64748b;font-size:13px;line-height:1.5;">
        Or copy and paste this link into your browser:
      </p>
      <p style="margin:0 0 24px;font-size:12px;word-break:break-all;color:#0284c7;">
        <a href="${safeLink}" style="color:#0284c7;">${safeLink}</a>
      </p>
      <p style="margin:0;padding-top:16px;border-top:1px solid #e2e8f0;color:#94a3b8;font-size:12px;line-height:1.5;">
        This link expires in 1 hour. If you did not request a password reset, please ignore this email and your password will remain unchanged.
      </p>
    `;

    await sendWithTimeout(
        getTransporter().sendMail({
            from: `"${senderName}" <${from || user}>`,
            to: email,
            subject: 'Reset your password - Data Guardian',
            text: `Hello,\n\nWe received a request to reset your password. Use the following link:\n\n${resetLink}\n\nThis link expires in 1 hour. If you did not request this, you can safely ignore this email.`,
            html: emailShell({
                title: 'Reset Your Password',
                subtitle: 'Security Request',
                preheader: 'Use this link to securely reset your Data Guardian password.',
                bodyHtml,
            }),
        }),
        'Password reset email',
    );
}

export async function sendPasswordChangedNotificationEmail(
    email: string,
    action: 'changed' | 'established' = 'changed',
): Promise<void> {
    if (!isEmailConfigured()) {
        logger.info(`[Email] SMTP not configured. Password ${action} notification skipped for ${redactEmail(email)}`);
        return;
    }

    const senderName = process.env.EMAIL_FROM_NAME || 'Data Guardian Security';
    const { from, user } = readEmailEnv();

    const bodyHtml = `
      <p style="margin:0 0 16px;color:#334155;font-size:15px;line-height:1.6;">
        Hello,
      </p>
      <p style="margin:0 0 24px;color:#475569;font-size:14px;line-height:1.6;">
        The password for your Data Guardian account was successfully ${escapeHtml(action)}.
      </p>
      <p style="margin:0 0 24px;color:#475569;font-size:14px;line-height:1.6;">
        If you performed this action, no further steps are needed.
      </p>
      <p style="margin:0;padding-top:16px;border-top:1px solid #e2e8f0;color:#dc2626;font-size:13px;line-height:1.5;">
        <strong>Important:</strong> If you did NOT initiate this change, your account may be compromised. Please reset your password immediately and contact support.
      </p>
    `;

    await sendWithTimeout(
        getTransporter().sendMail({
            from: `"${senderName}" <${from || user}>`,
            to: email,
            subject: `Security Alert: Account password ${action} - Data Guardian`,
            text: `Hello,\n\nThe password for your Data Guardian account was successfully ${action}.\n\nIf you did not perform this change, please reset your password immediately.`,
            html: emailShell({
                title: 'Security Alert',
                subtitle: `Password ${action === 'established' ? 'Established' : 'Changed'}`,
                preheader: `Your Data Guardian password was successfully ${action}.`,
                bodyHtml,
            }),
        }),
        'Password changed notification email',
    );
}
