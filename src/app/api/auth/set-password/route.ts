import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { setPasswordSchema } from '@/lib/validations';
import { hashPassword } from '@/lib/security/password';
import { validateCSRF } from '@/lib/security/csrf';
import { logger, redactEmail } from '@/lib/logger';

export async function POST(req: NextRequest) {
    const csrfResult = validateCSRF(req);
    if (!csrfResult.allowed) {
        return NextResponse.json({ error: csrfResult.reason }, { status: csrfResult.status });
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

        const passwordHash = await hashPassword(password);

        await prisma.user.update({
            where: { id: user.id },
            data: {
                passwordHash,
                // Ensure email is marked verified if not already
                emailVerified: new Date(),
            },
        });

        logger.info(`[Auth] Mandatory password setup completed for userId=${user.id} email=${redactEmail(user.email)}`);

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

