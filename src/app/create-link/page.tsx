import { redirect } from 'next/navigation';
import { auth } from '@/lib/auth';
import { listVendorOptions } from '@/lib/vendor-options';
import { ownerHasActiveLink } from '@/actions/dashboard';
import { canCreateSecureLinks } from '@/lib/security/role-helpers';
import { getOnboardingStep } from '@/lib/onboarding';
import CreateLinkClient from './CreateLinkClient';
import { isMongoConfigured, warmMongoConnection } from '@/lib/mongo/client';
import { warmEmailTransport } from '@/lib/email';
import { warmPrismaConnection } from '@/lib/prisma';

/**
 * JWT gate for first paint. Mutations still call requireOwnerRole on the server.
 * Vendor list + active-link check run in parallel with connection warm-up.
 */
export default async function CreateLinkPage() {
    if (isMongoConfigured()) {
        void warmMongoConnection().catch(() => {});
    }
    warmEmailTransport();
    void warmPrismaConnection().catch(() => {});

    const session = await auth();

    if (!session?.user?.id) {
        redirect('/auth/signin?callbackUrl=/create-link');
    }

    if (getOnboardingStep(session.user.roleSelected) === 'ROLE_SELECTION') {
        redirect('/auth/role-select?callbackUrl=/create-link');
    }

    if (!canCreateSecureLinks(session.user.role)) {
        redirect('/dashboard/vendor');
    }

    const [initialVendors, hasActiveLink] = await Promise.all([
        listVendorOptions(),
        ownerHasActiveLink(session.user.id),
    ]);

    return <CreateLinkClient initialVendors={initialVendors} hasActiveLink={hasActiveLink} />;
}
