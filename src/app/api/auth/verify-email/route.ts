import { NextRequest, NextResponse } from 'next/server';
import { verifyEmailSchema } from '@/lib/validations';
import { verifyEmailVerificationToken } from '@/lib/security/auth-tokens';
import { validateCSRF } from '@/lib/security/csrf';
import { logger } from '@/lib/logger';

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

    const parsed = verifyEmailSchema.safeParse(body);
    if (!parsed.success) {
        return NextResponse.json(
            { error: parsed.error.issues[0]?.message || 'Invalid verification token' },
            { status: 400 }
        );
    }

    const { token } = parsed.data;

    try {
        const result = await verifyEmailVerificationToken(token);
        if (!result.success) {
            return NextResponse.json(
                { error: result.error || 'Verification failed' },
                { status: 400 }
            );
        }

        return NextResponse.json({
            success: true,
            message: 'Email verified successfully. You may now sign in.',
            email: result.email,
        });
    } catch (error) {
        logger.error('[Verify Email] Unexpected error', error);
        return NextResponse.json(
            { error: 'An unexpected error occurred during email verification.' },
            { status: 500 }
        );
    }
}

