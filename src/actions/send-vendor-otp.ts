'use server';

import { prisma } from '@/lib/prisma';
import { generateOTP, hashOTP } from '@/lib/crypto';
import { checkOTPRateLimit, checkLinkRateLimit, extractClientIP, formatRateLimitError } from '@/lib/rate-limit';
import { headers } from 'next/headers';
import { logger, redactEmail } from '@/lib/logger';
import { isEmailConfigured } from '@/lib/email';

/** Minimum seconds between OTP emails for the same vendor+link (anti-spam). */
const RESEND_COOLDOWN_SECONDS = 60;

export type SendVendorOTPResult = {
    success: boolean;
    error?: string;
    errorType?: 'DENIED' | 'COOLDOWN' | 'EXPIRED' | 'REVOKED' | 'NOT_FOUND';
    retryAfterSeconds?: number;
};

export async function sendVendorOTP(input: {
    token: string;
    email: string;
}): Promise<SendVendorOTPResult> {
    try {
        const { token, email } = input;

        if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
            return { success: false, error: 'Invalid email address' };
        }

        const _headers = await headers();
        const clientIP = extractClientIP(_headers);

        const [rateLimit, linkLimit] = await Promise.all([
            checkOTPRateLimit(clientIP),
            checkLinkRateLimit(token),
        ]);
        if (!rateLimit.allowed || !linkLimit.allowed) {
            const limited = !rateLimit.allowed ? rateLimit : linkLimit;
            return {
                success: false,
                error: formatRateLimitError(limited),
                errorType: 'DENIED',
                retryAfterSeconds: limited.retryAfter,
            };
        }

        const normalizedEmail = email.toLowerCase().trim();

        const secureLink = await prisma.secureLink.findUnique({
            where: { token },
            select: {
                id: true,
                isRevoked: true,
                lockedAt: true,
                expiresAt: true,
                VendorAccess: {
                    select: {
                        id: true,
                        email: true,
                        isRevoked: true,
                        status: true,
                        loginCount: true,
                        maxLogins: true,
                        currentOtpCreatedAt: true,
                    },
                },
            },
        });

        if (!secureLink) {
            return {
                success: false,
                error: 'This link is invalid or has been deleted.',
                errorType: 'NOT_FOUND',
            };
        }

        if (secureLink.isRevoked || secureLink.lockedAt) {
            return {
                success: false,
                error: 'This link has been locked or revoked.',
                errorType: 'REVOKED',
            };
        }

        if (secureLink.expiresAt < new Date()) {
            return {
                success: false,
                error: 'This link has expired.',
                errorType: 'EXPIRED',
            };
        }

        const vendor = secureLink.VendorAccess.find(
            (v) => v.email.toLowerCase() === normalizedEmail,
        );

        if (!vendor) {
            return {
                success: false,
                error: 'This email is not authorized for this session.',
                errorType: 'DENIED',
            };
        }

        if (vendor.isRevoked) {
            return {
                success: false,
                error: 'Your access to this session has been revoked.',
                errorType: 'REVOKED',
            };
        }

        if (vendor.status === 'completed') {
            return {
                success: false,
                error: 'This task has already been completed.',
                errorType: 'DENIED',
            };
        }

        // Cooldown: avoid OTP email spam
        if (vendor.currentOtpCreatedAt) {
            const elapsedSec = Math.floor(
                (Date.now() - vendor.currentOtpCreatedAt.getTime()) / 1000,
            );
            if (elapsedSec < RESEND_COOLDOWN_SECONDS) {
                const retryAfterSeconds = RESEND_COOLDOWN_SECONDS - elapsedSec;
                return {
                    success: false,
                    error: `Please wait ${retryAfterSeconds}s before requesting another OTP.`,
                    errorType: 'COOLDOWN',
                    retryAfterSeconds,
                };
            }
        }

        const otp = generateOTP();
        const otpHash = await hashOTP(otp);
        const now = new Date();

        // Cap email validity at 10 minutes (or remaining link life)
        const remainingMs = secureLink.expiresAt.getTime() - now.getTime();
        const validityMinutes = Math.max(
            1,
            Math.min(10, Math.floor(remainingMs / 60000)),
        );
        const otpExpiresAt = new Date(
            Math.min(
                secureLink.expiresAt.getTime(),
                now.getTime() + validityMinutes * 60_000,
            ),
        );

        await prisma.$transaction(async (tx) => {
            await tx.otpHistory.updateMany({
                where: { vendorAccessId: vendor.id, status: 'ACTIVE' },
                data: {
                    status: 'INVALIDATED',
                    invalidatedAt: now,
                    reason: 'NEW_OTP_REQUESTED',
                },
            });

            await tx.vendorAccess.update({
                where: { id: vendor.id },
                data: {
                    otpHash,
                    currentOtpHash: otpHash,
                    currentOtpCreatedAt: now,
                    currentOtpExpiresAt: otpExpiresAt,
                },
            });

            // Fresh OTP must be enterable after a prior successful unlock (single-use
            // applies to the old code, not to this vendor forever).
            await tx.linkAccess.updateMany({
                where: {
                    secureLinkId: secureLink.id,
                    vendorEmail: { equals: normalizedEmail, mode: 'insensitive' },
                },
                data: {
                    isUsed: false,
                    otpHash,
                    failedAttempts: 0,
                    lockedAt: null,
                },
            });

            await tx.otpHistory.create({
                data: {
                    vendorAccessId: vendor.id,
                    otpHash,
                    reason: 'OTP_REQUESTED',
                    status: 'ACTIVE',
                },
            });

            await tx.auditLog.create({
                data: {
                    action: 'OTP_RESENT',
                    linkId: secureLink.id,
                    reason: 'Vendor requested a new OTP',
                    metadata: JSON.stringify({
                        vendorEmail: redactEmail(normalizedEmail),
                        validityMinutes,
                    }),
                },
            });
        });

        if (!isEmailConfigured()) {
            logger.error('[EMAIL] EMAIL_USER/EMAIL_PASS (or SMTP_USER/SMTP_PASS) not set on server');
            return {
                success: false,
                error: 'Email is not configured on the server. Contact the link owner.',
            };
        }

        try {
            const { sendOTPEmail } = await import('@/lib/email');
            await sendOTPEmail(normalizedEmail, token, otp, validityMinutes);
        } catch (err) {
            logger.error(
                `[EMAIL FAILED] Could not send OTP to ${redactEmail(normalizedEmail)}`,
                err instanceof Error ? err.message : err,
            );
            return {
                success: false,
                error:
                    'Could not deliver the OTP email. Check spam or try again in a minute.',
            };
        }

        logger.info(`OTP SENT TO: ${redactEmail(normalizedEmail)}`);

        return { success: true };
    } catch (e) {
        logger.error('Failed to send vendor OTP:', e);
        return {
            success: false,
            error: 'Failed to request OTP. Please try again.',
        };
    }
}
