import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { signUpSchema } from '@/lib/validations';
import { hashPassword } from '@/lib/security/password';
import { createEmailVerificationToken } from '@/lib/security/auth-tokens';
import { sendVerificationEmail } from '@/lib/email';
import { checkRegisterRateLimit, extractClientIP } from '@/lib/rate-limit';
import { validateCSRF } from '@/lib/security/csrf';
import { logger, redactEmail } from '@/lib/logger';

export async function POST(req: NextRequest) {
    const csrfResult = validateCSRF(req);
    if (!csrfResult.allowed) {
        return NextResponse.json({ error: csrfResult.reason }, { status: csrfResult.status });
    }

    const ip = extractClientIP(req.headers);
    const rateLimit = await checkRegisterRateLimit(ip);
    if (!rateLimit.allowed) {
        return NextResponse.json(
            { error: 'Too many registration attempts. Please try again later.' },
            { status: 429 }
        );
    }

    let body: unknown;
    try {
        body = await req.json();
    } catch {
        return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }

    const parsed = signUpSchema.safeParse(body);
    if (!parsed.success) {
        const firstError = parsed.error.issues[0]?.message || 'Validation failed';
        return NextResponse.json({ error: firstError }, { status: 400 });
    }

    const { name, email, password } = parsed.data;
    const normalizedEmail = email.trim().toLowerCase();

    try {
        // Prevent duplicate email registrations
        const existingUser = await prisma.user.findUnique({
            where: { email: normalizedEmail },
        });

        if (existingUser) {
            logger.warn(`[Registration] Duplicate email attempt email=${redactEmail(normalizedEmail)}`);
            return NextResponse.json(
                { error: 'An account with this email address already exists. Please sign in.' },
                { status: 409 }
            );
        }

        const passwordHash = await hashPassword(password);

        // Create user with email unverified and initial VENDOR role
        const newUser = await prisma.user.create({
            data: {
                name: name.trim(),
                email: normalizedEmail,
                passwordHash,
                authProvider: 'email',
                role: 'VENDOR',
                roleSelected: false,
                emailVerified: null,
            },
        });

        // Generate verification token and send activation email
        const token = await createEmailVerificationToken(normalizedEmail);
        try {
            await sendVerificationEmail(normalizedEmail, token, name.trim());
        } catch (mailError) {
            logger.error('[Registration] Failed to send verification email', mailError);
        }

        logger.info(`[Registration] New user registered id=${newUser.id} email=${redactEmail(normalizedEmail)}`);

        return NextResponse.json(
            {
                success: true,
                message: 'Account created successfully! Please check your email to verify your account.',
                email: normalizedEmail,
            },
            { status: 201 }
        );
    } catch (error) {
        logger.error('[Registration] Registration failure', error);
        return NextResponse.json(
            { error: 'Registration failed due to a server error. Please try again.' },
            { status: 500 }
        );
    }
}

