import { redirect } from 'next/navigation';
import { auth } from '@/lib/auth';
import { listVendorOptions } from '@/lib/vendor-options';
import CreateLinkClient from './CreateLinkClient';

/**
 * Auth + vendor list on the server — form paints with data ready (no client waterfall).
 */
export default async function CreateLinkPage() {
    const session = await auth();

    if (!session?.user) {
        redirect('/auth/signin?callbackUrl=/create-link');
    }

    const onboardingComplete =
        session.user.onboardingStep === 'COMPLETE' ||
        (session.user.onboardingStep == null && session.user.roleSelected);
    if (!onboardingComplete) {
        redirect('/auth/role-select?callbackUrl=/create-link');
    }

    if (session.user.role !== 'OWNER') {
        redirect('/dashboard/vendor');
    }

    // Role already checked above — skip a second auth()+findMany on this request.
    const initialVendors = await listVendorOptions();

    return <CreateLinkClient initialVendors={initialVendors} />;
}
