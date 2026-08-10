import { redirect } from 'next/navigation';
import { auth } from '@/lib/auth';
import { getOwnerDashboardData } from '@/actions/dashboard';
import OwnerDashboardClient from './OwnerDashboardClient';

/**
 * Prefetch dashboard data on the server so the client skips the
 * session → server-action waterfall on first paint.
 * Uses sequential DB reads to avoid Neon connection-pool timeouts.
 */
export default async function OwnerDashboardPage() {
    const session = await auth();

    if (!session?.user?.id) {
        redirect('/auth/signin?callbackUrl=/dashboard/owner');
    }

    // Prefer onboardingStep; fall back to roleSelected for older JWTs
    const onboardingComplete =
        session.user.onboardingStep === 'COMPLETE' ||
        (session.user.onboardingStep == null && session.user.roleSelected);
    if (!onboardingComplete) {
        redirect('/auth/role-select?callbackUrl=/dashboard/owner');
    }

    if (session.user.role === 'VENDOR') {
        redirect('/dashboard/vendor');
    }

    const { links: initialLinks, history: initialHistory } = await getOwnerDashboardData(
        session.user.id,
    );

    return (
        <OwnerDashboardClient
            initialLinks={initialLinks}
            initialHistory={initialHistory}
            userId={session.user.id}
            userLabel={session.user.name || session.user.email || 'Owner'}
        />
    );
}
