import { redirect } from 'next/navigation';
import { auth } from '@/lib/auth';
import { listVendorOptions } from '@/lib/vendor-options';
import { ownerHasActiveLink } from '@/actions/dashboard';
import { getDbUserRole } from '@/lib/security/roles';
import { getOnboardingStep } from '@/lib/onboarding';
import CreateLinkClient from './CreateLinkClient';

/**
 * Auth + vendor list on the server — form paints with data ready (no client waterfall).
 * Role gate uses Postgres, never JWT alone.
 */
export default async function CreateLinkPage() {
    const session = await auth();

    if (!session?.user?.id) {
        redirect('/auth/signin?callbackUrl=/create-link');
    }

    const [dbUser, initialVendors, hasActiveLink] = await Promise.all([
        getDbUserRole(session.user.id),
        listVendorOptions(),
        ownerHasActiveLink(session.user.id),
    ]);

    if (!dbUser) {
        redirect('/auth/signin?callbackUrl=/create-link');
    }

    if (getOnboardingStep(dbUser.roleSelected) === 'ROLE_SELECTION') {
        redirect('/auth/role-select?callbackUrl=/create-link');
    }

    if (dbUser.role !== 'OWNER') {
        redirect('/dashboard/vendor');
    }

    return <CreateLinkClient initialVendors={initialVendors} hasActiveLink={hasActiveLink} />;
}
