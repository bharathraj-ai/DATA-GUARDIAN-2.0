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
export default async function OwnerDashboardPage({
    searchParams,
}: {
    searchParams: Promise<{ created?: string }>;
}) {
    const session = await auth();

    if (!session?.user?.id) {
        redirect('/auth/signin?callbackUrl=/dashboard/owner');
    }

    const [dbUser, dash, sp] = await Promise.all([
        getDbUserRole(session.user.id),
        getOwnerDashboardData(session.user.id),
        searchParams,
    ]);

    if (!dbUser) {
        redirect('/auth/signin?callbackUrl=/dashboard/owner');
    }

    if (getOnboardingStep(dbUser.roleSelected) === 'ROLE_SELECTION') {
        redirect('/auth/role-select?callbackUrl=/dashboard/owner');
    }

    if (dbUser.role === 'VENDOR') {
        redirect('/dashboard/vendor');
    }

    return (
        <OwnerDashboardClient
            initialLinks={dash.links}
            initialHistory={dash.history}
            userId={session.user.id}
            userLabel={session.user.name || session.user.email || 'Owner'}
            justCreated={sp.created === '1'}
        />
    );
}
