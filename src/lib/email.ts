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
let warming: Promise<void> | null = null;

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
              <p style="margin:0;color:#94a3b8;font-size:12px;">Secure Protocol · AES-256 · OTP protected</p>
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
    const senderName = process.env.EMAIL_FROM_NAME || 'Secure Protocol Security';
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
            subject: 'Secure Protocol: Secure access OTP',
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
    const senderName = process.env.EMAIL_FROM_NAME || 'Secure Protocol Security';
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
            subject: `Secure Protocol: Work delivered (${fileCount} file${fileCount === 1 ? '' : 's'})`,
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
    const senderName = process.env.EMAIL_FROM_NAME || 'Secure Protocol Security';
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
