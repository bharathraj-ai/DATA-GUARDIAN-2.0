import { redirect } from 'next/navigation';
import { auth } from '@/lib/auth';
import { getAvailableVendors } from '@/actions/get-vendors';
import CreateLinkClient from './CreateLinkClient';

/**
 * Auth + vendor list on the server — form paints with data ready (no client waterfall).
 */
export default async function CreateLinkPage() {
    const session = await auth();

    if (!session?.user) {
        redirect('/auth/signin?callbackUrl=/create-link');
    }

    if (!session.user.roleSelected) {
        redirect('/auth/role-select?callbackUrl=/create-link');
    }

    if (session.user.role !== 'OWNER') {
        redirect('/dashboard/vendor');
    }

    const initialVendors = await getAvailableVendors();

    return <CreateLinkClient initialVendors={initialVendors} />;
}
