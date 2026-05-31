'use server';

import { prisma } from '@/lib/prisma';
import { generateOTP, hashOTP } from '@/lib/crypto';
import { checkOTPRateLimit, extractClientIP, formatRateLimitError } from '@/lib/rate-limit';
import { headers } from 'next/headers';

export async function sendVendorOTP(input: { token: string; email: string }) {
    try {
        const { token, email } = input;
        
        if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
            return { success: false, error: 'Invalid email address' };
        }

        const _headers = await headers();
        const clientIP = extractClientIP(_headers);

        // ANTI-PHISHING: Rate limiting check
        const rateLimit = await checkOTPRateLimit(clientIP);
        if (!rateLimit.allowed) {
            return {
                success: false,
                error: formatRateLimitError(rateLimit),
                errorType: 'DENIED'
            };
        }

        const normalizedEmail = email.toLowerCase().trim();

        // Find secure link
        const secureLink = await prisma.secureLink.findUnique({
            where: { token },
            include: {
                VendorAccess: true
            }
        });

        if (!secureLink) {
            return { success: false, error: 'This link is invalid or has been deleted.' };
        }

        if (secureLink.isRevoked || secureLink.lockedAt) {
            return { success: false, error: 'This link has been locked or revoked.' };
        }

        const vendor = secureLink.VendorAccess.find(v => v.email === normalizedEmail);

        if (!vendor) {
            return { success: false, error: 'This email is not authorized for this session.' };
        }

        if (vendor.isRevoked) {
            return { success: false, error: 'Your access to this session has been revoked.' };
        }

        if (vendor.loginCount >= vendor.maxLogins) {
            return { success: false, error: `You have reached the maximum number of logins (${vendor.maxLogins}) for this session.` };
        }

        // Generate OTP
        const otp = generateOTP();
        const otpHash = await hashOTP(otp);

        // Update vendor with new OTP hash
        await prisma.vendorAccess.update({
            where: { id: vendor.id },
            data: { otpHash }
        });

        // Track first OTP attempt (starts 5-min window)
        const now = new Date();
        await prisma.secureLink.update({
            where: { id: secureLink.id },
            data: { otpFirstAttemptAt: now }
        });

        // Send email
        import('@/lib/email').then(({ sendOTPEmail }) => {
            // Need validity minutes, default to 5 or based on expiry
            const remainingMs = secureLink.expiresAt.getTime() - Date.now();
            const validityMinutes = Math.max(1, Math.floor(remainingMs / 60000));
            
            sendOTPEmail(normalizedEmail, token, otp, Math.min(validityMinutes, 5))
                .catch((err) => {
                    console.error('====================================================');
                    console.error(`[EMAIL FAILED] Could not send OTP to ${normalizedEmail}`);
                    console.error('Make sure EMAIL_USER and EMAIL_PASS are set in .env');
                    console.error(err.message);
                    console.error('====================================================');
                });
        });

        // LOCAL DEV FALLBACK: Always log the OTP to the console so the user can test
        import('@/lib/logger').then(({ logger, redactEmail }) => {
            logger.info(`OTP REQUESTED FOR: ${redactEmail(normalizedEmail)}`);
            logger.debug(`[LOCAL DEV] OTP CODE: ${otp}`);
        });

        return { success: true };
    } catch (e) {
        console.error('Failed to send vendor OTP:', e);
        return { success: false, error: 'Failed to request OTP. Please try again.' };
    }
}
