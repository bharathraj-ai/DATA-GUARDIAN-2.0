import { Suspense } from 'react';
import { redirect } from 'next/navigation';
import { auth } from '@/lib/auth';
import { getReceivedLinks } from '@/actions/dashboard';
import { getOnboardingStep } from '@/lib/onboarding';
import { normalizeRole } from '@/lib/security/roles';
import VendorDashboardClient from './VendorDashboardClient';
import DashboardSkeleton from '../DashboardSkeleton';

async function VendorDashboardData({ email }: { email: string }) {
    const initialLinks = await getReceivedLinks(email);
    return <VendorDashboardClient initialLinks={initialLinks} userEmail={email} />;
}

/**
 * JWT role gate first (fast redirect), then stream links so the shell paints immediately.
 */
export default async function VendorDashboardPage() {
    const session = await auth();

    if (!session?.user?.id || !session.user.email) {
        redirect('/auth/signin?callbackUrl=/dashboard/vendor');
    }

    if (getOnboardingStep(session.user.roleSelected) === 'ROLE_SELECTION') {
        redirect('/auth/role-select?callbackUrl=/dashboard/vendor');
    }

    if (normalizeRole(session.user.role) === 'OWNER') {
        redirect('/dashboard/owner');
    }

    return (
        <Suspense fallback={<DashboardSkeleton />}>
            <VendorDashboardData email={session.user.email} />
        </Suspense>
    );
}
