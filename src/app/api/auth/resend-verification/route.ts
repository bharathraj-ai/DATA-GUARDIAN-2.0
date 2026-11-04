import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { forgotPasswordSchema } from '@/lib/validations';
import { createEmailVerificationToken } from '@/lib/security/auth-tokens';
import { sendVerificationEmail } from '@/lib/email';
import { checkForgotPasswordRateLimit, extractClientIP } from '@/lib/rate-limit';
import { validateCSRF } from '@/lib/security/csrf';
import { logger, redactEmail } from '@/lib/logger';

export async function POST(req: NextRequest) {
    const csrfResult = validateCSRF(req);
    if (!csrfResult.allowed) {
        return NextResponse.json({ error: csrfResult.reason }, { status: csrfResult.status });
    }

    let body: unknown;
    try {
        body = await req.json();
    } catch {
        return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }

    const parsed = forgotPasswordSchema.safeParse(body);
    if (!parsed.success) {
        return NextResponse.json(
            { error: parsed.error.issues[0]?.message || 'Invalid email address' },
            { status: 400 }
        );
    }

    const { email } = parsed.data;
    const normalizedEmail = email.trim().toLowerCase();
    const ip = extractClientIP(req.headers);

    const rateLimit = await checkForgotPasswordRateLimit(ip, normalizedEmail);
    if (!rateLimit.allowed) {
        return NextResponse.json(
            { error: 'Too many requests. Please wait a few minutes before requesting another email.' },
            { status: 429 }
        );
    }

    try {
        const user = await prisma.user.findUnique({
            where: { email: normalizedEmail },
            select: { id: true, name: true, emailVerified: true },
        });

        if (user && !user.emailVerified) {
            const token = await createEmailVerificationToken(normalizedEmail);
            try {
                await sendVerificationEmail(normalizedEmail, token, user.name || undefined);
            } catch (mailError) {
                logger.error('[Resend Verification] Failed to send email', mailError);
            }
        } else {
            logger.info(`[Resend Verification] Skipped for email=${redactEmail(normalizedEmail)} (already verified or not found)`);
        }

        // Generic response to avoid enumeration
        return NextResponse.json({
            success: true,
            message: 'If an unverified account exists with that email address, a new verification link has been sent.',
        });
    } catch (error) {
        logger.error('[Resend Verification] Error', error);
        return NextResponse.json(
            { error: 'Failed to process request. Please try again later.' },
            { status: 500 }
        );
    }
}

