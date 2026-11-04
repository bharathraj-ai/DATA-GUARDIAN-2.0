import { NextRequest, NextResponse } from 'next/server';
import { forgotPasswordSchema } from '@/lib/validations';
import { createPasswordResetToken } from '@/lib/security/auth-tokens';
import { sendPasswordResetEmail } from '@/lib/email';
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
            { error: 'Too many password reset attempts. Please try again later.' },
            { status: 429 }
        );
    }

    try {
        const token = await createPasswordResetToken(normalizedEmail);
        if (token) {
            try {
                await sendPasswordResetEmail(normalizedEmail, token);
            } catch (mailError) {
                logger.error('[Forgot Password] Failed to send reset email', mailError);
            }
        } else {
            logger.info(`[Forgot Password] Reset requested for non-existent email=${redactEmail(normalizedEmail)}`);
        }

        // Generic response: never disclose whether the email is registered
        return NextResponse.json({
            success: true,
            message: 'If an account exists with that email address, a password reset link has been sent.',
        });
    } catch (error) {
        logger.error('[Forgot Password] Unexpected error', error);
        return NextResponse.json(
            { error: 'Unable to process your request at this time. Please try again later.' },
            { status: 500 }
        );
    }
}

