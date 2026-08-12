import { redirect } from 'next/navigation';
import { auth } from '@/lib/auth';
import { getOwnerDashboardData } from '@/actions/dashboard';
import { getDbUserRole } from '@/lib/security/roles';
import { getOnboardingStep } from '@/lib/onboarding';
import OwnerDashboardClient from './OwnerDashboardClient';

/**
 * Prefetch dashboard data on the server so the client skips the
 * session → server-action waterfall on first paint.
 * Role gate uses Postgres, never JWT alone.
 */
export default async function OwnerDashboardPage() {
    const session = await auth();

    if (!session?.user?.id) {
        redirect('/auth/signin?callbackUrl=/dashboard/owner');
    }

    const dbUser = await getDbUserRole(session.user.id);
    if (!dbUser) {
        redirect('/auth/signin?callbackUrl=/dashboard/owner');
    }

    if (getOnboardingStep(dbUser.roleSelected) === 'ROLE_SELECTION') {
        redirect('/auth/role-select?callbackUrl=/dashboard/owner');
    }

    if (dbUser.role === 'VENDOR') {
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
