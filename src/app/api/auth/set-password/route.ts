import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { setPasswordSchema } from '@/lib/validations';
import { hashPassword } from '@/lib/security/password';
import { validateCSRF } from '@/lib/security/csrf';
import { checkResetPasswordRateLimit, extractClientIP } from '@/lib/rate-limit';
import { sendPasswordChangedNotificationEmail } from '@/lib/email';
import { logger, redactEmail } from '@/lib/logger';

export async function POST(req: NextRequest) {
    const csrfResult = validateCSRF(req);
    if (!csrfResult.allowed) {
        return NextResponse.json({ error: csrfResult.reason }, { status: csrfResult.status });
    }

    const ip = extractClientIP(req.headers);
    const rateLimit = await checkResetPasswordRateLimit(ip);
    if (!rateLimit.allowed) {
        return NextResponse.json(
            { error: 'Too many password attempts. Please try again later.' },
            { status: 429 }
        );
    }

    const session = await auth();
    if (!session?.user?.id) {
        return NextResponse.json(
            { error: 'Unauthorized: You must have an active session to set a password.' },
            { status: 401 }
        );
    }

    let body: unknown;
    try {
        body = await req.json();
    } catch {
        return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }

    const parsed = setPasswordSchema.safeParse(body);
    if (!parsed.success) {
        return NextResponse.json(
            { error: parsed.error.issues[0]?.message || 'Invalid password input' },
            { status: 400 }
        );
    }

    const { password } = parsed.data;

    try {
        const user = await prisma.user.findUnique({
            where: { id: session.user.id },
            select: { id: true, email: true, passwordHash: true },
        });

        if (!user) {
            return NextResponse.json({ error: 'User account not found.' }, { status: 404 });
        }

        // Never overwrite an existing password without verification (reauthentication / reset flow required)
        if (user.passwordHash) {
            logger.warn(`[Auth] Rejected set-password: password already established userId=${user.id}`);
            return NextResponse.json(
                { error: 'A password has already been established for this account. To change your password, please use the password reset flow.' },
                { status: 409 }
            );
        }

        const passwordHash = await hashPassword(password);

        // Atomic conditional update to safely prevent concurrent overwrite races
        const updated = await prisma.user.updateMany({
            where: {
                id: user.id,
                passwordHash: null,
            },
            data: {
                passwordHash,
                emailVerified: new Date(),
            },
        });

        if (updated.count === 0) {
            logger.warn(`[Auth] Concurrent password setup prevented for userId=${user.id}`);
            return NextResponse.json(
                { error: 'A password has already been established for this account.' },
                { status: 409 }
            );
        }

        logger.info(`[Auth] Mandatory password setup completed for userId=${user.id} email=${redactEmail(user.email)}`);

        // Send security notification email (best-effort, non-blocking)
        sendPasswordChangedNotificationEmail(user.email, 'established').catch((err) => {
            logger.warn('[Auth] Failed to send password established notification email', err);
        });

        return NextResponse.json({
            success: true,
            message: 'Password established successfully.',
        });
    } catch (error) {
        logger.error('[Auth] Failed to set password for OAuth user', error);
        return NextResponse.json(
            { error: 'An unexpected error occurred while saving your password.' },
            { status: 500 }
        );
    }
}

