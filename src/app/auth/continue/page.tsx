import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { logger, redactEmail } from '@/lib/logger';
import {
    getOnboardingStep,
    resolvePostAuthRedirect,
    safeCallbackPath,
} from '@/lib/onboarding';
import { redirect } from 'next/navigation';

interface Props {
    searchParams: Promise<{ callbackUrl?: string }> | { callbackUrl?: string };
}

/**
 * Post-OAuth / post-login router.
 * Session cookie is already set by NextAuth before this page runs.
 * Server DB is the source of truth for onboarding — never sends completed
 * users to /auth/role-select.
 */
export default async function AuthContinuePage({ searchParams }: Props) {
    const resolved = await searchParams;
    const callbackUrl = safeCallbackPath(resolved.callbackUrl);

    const session = await auth();

    if (!session?.user?.id) {
        const signInUrl = callbackUrl
            ? `/auth/signin?callbackUrl=${encodeURIComponent(callbackUrl)}`
            : '/auth/signin';
        redirect(signInUrl);
    }

    const dbUser = await prisma.user.findUnique({
        where: { id: session.user.id },
        select: { email: true, role: true, roleSelected: true, emailVerified: true, passwordHash: true },
    });

    if (!dbUser) {
        logger.warn(`[Auth] /auth/continue: session user missing in DB id=${session.user.id}`);
        redirect('/auth/signin');
    }

    if (!dbUser.emailVerified) {
        // Check if user has an OAuth account linked (e.g. Google)
        const hasOAuth = await prisma.account.findFirst({
            where: { userId: session.user.id },
            select: { id: true },
        });

        if (hasOAuth) {
            // OAuth accounts are pre-verified by the provider
            await prisma.user.update({
                where: { id: session.user.id },
                data: { emailVerified: new Date() },
            });
            dbUser.emailVerified = new Date();
        } else {
            logger.info(`[Auth] /auth/continue: unverified email, redirecting email=${redactEmail(dbUser.email)}`);
            redirect(`/auth/verify-email?email=${encodeURIComponent(dbUser.email)}`);
        }
    }

    // Mandatory password setup for OAuth users without a password
    if (!dbUser.passwordHash) {
        logger.info(`[Google OAuth] Password setup required for email=${redactEmail(dbUser.email)}`);
        redirect('/auth/set-password');
    }

    const onboardingStep = getOnboardingStep(dbUser.roleSelected);
    const target = resolvePostAuthRedirect({
        roleSelected: dbUser.roleSelected,
        role: dbUser.role,
        callbackUrl,
    });

    logger.info(
        `[Google OAuth] email=${redactEmail(dbUser.email)} existingCompletedUser=${dbUser.roleSelected} onboardingStep=${onboardingStep} Redirect: ${target}`
    );

    redirect(target);
}
