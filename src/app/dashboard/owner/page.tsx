import { Suspense } from 'react';
import { redirect } from 'next/navigation';
import { auth } from '@/lib/auth';
import { getOwnerDashboardData } from '@/actions/dashboard';
import { getOnboardingStep } from '@/lib/onboarding';
import { normalizeRole } from '@/lib/security/roles';
import OwnerDashboardClient from './OwnerDashboardClient';
import DashboardSkeleton from '../DashboardSkeleton';

async function OwnerDashboardData({
    userId,
    userLabel,
    justCreated,
}: {
    userId: string;
    userLabel: string;
    justCreated: boolean;
}) {
    const dash = await getOwnerDashboardData(userId);
    return (
        <OwnerDashboardClient
            initialLinks={dash.links}
            initialHistory={dash.history}
            userId={userId}
            userLabel={userLabel}
            justCreated={justCreated}
        />
    );
}

/**
 * JWT role gate first (fast redirect), then stream links so the shell paints immediately.
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

    if (getOnboardingStep(session.user.roleSelected) === 'ROLE_SELECTION') {
        redirect('/auth/role-select?callbackUrl=/dashboard/owner');
    }

    if (normalizeRole(session.user.role) === 'VENDOR') {
        redirect('/dashboard/vendor');
    }

    const sp = await searchParams;

    return (
        <Suspense fallback={<DashboardSkeleton />}>
            <OwnerDashboardData
                userId={session.user.id}
                userLabel={session.user.name || session.user.email || 'Owner'}
                justCreated={sp.created === '1'}
            />
        </Suspense>
    );
}
