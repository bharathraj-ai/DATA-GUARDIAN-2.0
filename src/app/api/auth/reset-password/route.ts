import { NextRequest, NextResponse } from 'next/server';
import { resetPasswordSchema } from '@/lib/validations';
import { verifyAndConsumePasswordResetToken } from '@/lib/security/auth-tokens';
import { checkResetPasswordRateLimit, extractClientIP } from '@/lib/rate-limit';
import { validateCSRF } from '@/lib/security/csrf';
import { logger } from '@/lib/logger';

export async function POST(req: NextRequest) {
    const csrfResult = validateCSRF(req);
    if (!csrfResult.allowed) {
        return NextResponse.json({ error: csrfResult.reason }, { status: csrfResult.status });
    }

    const ip = extractClientIP(req.headers);
    const rateLimit = await checkResetPasswordRateLimit(ip);
    if (!rateLimit.allowed) {
        return NextResponse.json(
            { error: 'Too many password reset attempts. Please try again later.' },
            { status: 429 }
        );
    }

    let body: unknown;
    try {
        body = await req.json();
    } catch {
        return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }

    const parsed = resetPasswordSchema.safeParse(body);
    if (!parsed.success) {
        return NextResponse.json(
            { error: parsed.error.issues[0]?.message || 'Invalid input data' },
            { status: 400 }
        );
    }

    const { token, password } = parsed.data;

    try {
        const result = await verifyAndConsumePasswordResetToken(token, password);
        if (!result.success) {
            return NextResponse.json({ error: result.error || 'Failed to reset password' }, { status: 400 });
        }

        return NextResponse.json({
            success: true,
            message: 'Your password has been reset successfully. You can now sign in with your new password.',
        });
    } catch (error) {
        logger.error('[Reset Password] Unexpected error', error);
        return NextResponse.json(
            { error: 'An unexpected error occurred while resetting your password.' },
            { status: 500 }
        );
    }
}

