import { redirect } from 'next/navigation';
import { auth } from '@/lib/auth';
import { getReceivedLinks } from '@/actions/dashboard';
import { getDbUserRole } from '@/lib/security/roles';
import { getOnboardingStep } from '@/lib/onboarding';
import VendorDashboardClient from './VendorDashboardClient';

/**
 * Prefetch received links on the server — eliminates client session waterfall.
 * Role gate uses Postgres, never JWT alone.
 */
export default async function VendorDashboardPage() {
    const session = await auth();

    if (!session?.user?.id || !session.user.email) {
        redirect('/auth/signin?callbackUrl=/dashboard/vendor');
    }

    const dbUser = await getDbUserRole(session.user.id);
    if (!dbUser) {
        redirect('/auth/signin?callbackUrl=/dashboard/vendor');
    }

    if (getOnboardingStep(dbUser.roleSelected) === 'ROLE_SELECTION') {
        redirect('/auth/role-select?callbackUrl=/dashboard/vendor');
    }

    if (dbUser.role === 'OWNER') {
        redirect('/dashboard/owner');
    }

    const initialLinks = await getReceivedLinks(session.user.email);

    return (
        <VendorDashboardClient
            initialLinks={initialLinks}
            userEmail={session.user.email}
        />
    );
}
