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
        select: { email: true, role: true, roleSelected: true },
    });

    if (!dbUser) {
        logger.warn(`[Google OAuth] /auth/continue: session user missing in DB id=${session.user.id}`);
        redirect('/auth/signin');
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
