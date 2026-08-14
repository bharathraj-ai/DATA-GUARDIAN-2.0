import { redirect } from 'next/navigation';
import { auth } from '@/lib/auth';
import { dashboardPathForRole, getOnboardingStep } from '@/lib/onboarding';

/**
 * Instant JWT redirect — no Neon round-trip. Role dashboards still gate on DB.
 */
export default async function DashboardPage() {
    const session = await auth();

    if (!session?.user?.id) {
        redirect('/auth/signin?callbackUrl=/dashboard');
    }

    if (getOnboardingStep(session.user.roleSelected) === 'ROLE_SELECTION') {
        redirect('/auth/role-select?callbackUrl=/dashboard');
    }

    redirect(dashboardPathForRole(session.user.role));
}
