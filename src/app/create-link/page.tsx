import { redirect } from 'next/navigation';
import { auth } from '@/lib/auth';
import { listVendorOptions } from '@/lib/vendor-options';
import { ownerHasActiveLink } from '@/actions/dashboard';
import { getDbUserRole, dashboardPathForRole } from '@/lib/security/roles';
import { getOnboardingStep } from '@/lib/onboarding';
import CreateLinkClient from './CreateLinkClient';
import { isMongoConfigured, warmMongoConnection } from '@/lib/mongo/client';
import { warmEmailTransport } from '@/lib/email';
import { warmPrismaConnection } from '@/lib/prisma';

/**
 * Auth + vendor list on the server — form paints with data ready (no client waterfall).
 * Role gate uses Postgres, never JWT alone.
 */
export default async function CreateLinkPage() {
    if (isMongoConfigured()) {
        void warmMongoConnection().catch(() => {});
    }
    warmEmailTransport();

    const [, session] = await Promise.all([warmPrismaConnection(), auth()]);

    if (!session?.user?.id) {
        redirect('/auth/signin?callbackUrl=/create-link');
    }

    const dbUser = await getDbUserRole(session.user.id);

    if (!dbUser) {
        redirect('/auth/signin?callbackUrl=/create-link');
    }

    if (getOnboardingStep(dbUser.roleSelected) === 'ROLE_SELECTION') {
        redirect('/auth/role-select?callbackUrl=/create-link');
    }

    if (dbUser.role !== 'OWNER') {
        redirect(dashboardPathForRole(dbUser.role));
    }

    const [initialVendors, hasActiveLink] = await Promise.all([
        listVendorOptions(),
        ownerHasActiveLink(session.user.id),
    ]);

    return <CreateLinkClient initialVendors={initialVendors} hasActiveLink={hasActiveLink} />;
}
