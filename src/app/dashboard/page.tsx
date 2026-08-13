import { redirect } from 'next/navigation';
import { auth } from '@/lib/auth';
import { getDbUserRole } from '@/lib/security/roles';
import { dashboardPathForRole, getOnboardingStep } from '@/lib/onboarding';

/**
 * Server-side role redirect — avoids client session waterfall before navigating.
 * Onboarding incomplete → role-select; complete → owner/vendor dashboard.
 */
export default async function DashboardPage() {
    const session = await auth();

    if (!session?.user?.id) {
        redirect('/auth/signin?callbackUrl=/dashboard');
    }

    const dbUser = await getDbUserRole(session.user.id);

    if (!dbUser) {
        redirect('/auth/signin?callbackUrl=/dashboard');
    }

    if (getOnboardingStep(dbUser.roleSelected) === 'ROLE_SELECTION') {
        redirect('/auth/role-select?callbackUrl=/dashboard');
    }

    redirect(dashboardPathForRole(dbUser.role));
}
