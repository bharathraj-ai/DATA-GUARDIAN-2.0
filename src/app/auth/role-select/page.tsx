import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { logger, redactEmail } from '@/lib/logger';
import {
    dashboardPathForRole,
    getOnboardingStep,
    safeCallbackPath,
} from '@/lib/onboarding';
import { setUserRole } from '@/actions/set-role';
import { redirect } from 'next/navigation';
import { Suspense } from 'react';
import RoleSelectClient from './RoleSelectClient';

interface Props {
    searchParams: Promise<{ callbackUrl?: string }> | { callbackUrl?: string };
}

/**
 * Role selection is only for authenticated users with onboardingStep=ROLE_SELECTION.
 * Completed users are redirected to the dashboard immediately (DB is source of truth).
 */
export default async function RoleSelectPage({ searchParams }: Props) {
    const resolvedSearchParams = await searchParams;
    const callbackUrl = safeCallbackPath(resolvedSearchParams.callbackUrl);

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
        redirect('/auth/signin');
    }

    const onboardingStep = getOnboardingStep(dbUser.roleSelected);

    // Completed users must never see role-select
    if (onboardingStep === 'COMPLETE') {
        // Prefer callback for OWNER only (preserves prior behavior for deep links)
        const destination =
            dbUser.role === 'OWNER' && callbackUrl
                ? callbackUrl
                : dashboardPathForRole(dbUser.role);

        logger.info(
            `[Google OAuth] /auth/role-select blocked for completed user email=${redactEmail(dbUser.email)} Redirect: ${destination}`
        );
        redirect(destination);
    }

    return (
        <Suspense fallback={
            <main className="app-page">
                <section className="app-section">
                    <div className="container">
                        <div className="app-container" style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '400px' }}>
                            <div style={{ textAlign: 'center' }}>
                                <div className="button-spinner" style={{ width: '48px', height: '48px', margin: '0 auto 16px' }}></div>
                                <p style={{ color: 'var(--color-text-secondary)' }}>Loading...</p>
                            </div>
                        </div>
                    </div>
                </section>
            </main>
        }>
            <RoleSelectClient callbackUrl={callbackUrl} session={session} onSetRole={setUserRole} />
        </Suspense>
    );
}
