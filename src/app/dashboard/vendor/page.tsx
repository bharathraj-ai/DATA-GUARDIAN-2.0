import { redirect } from 'next/navigation';
import { auth } from '@/lib/auth';
import { getReceivedLinks } from '@/actions/dashboard';
import VendorDashboardClient from './VendorDashboardClient';

/**
 * Prefetch received links on the server — eliminates client session waterfall.
 */
export default async function VendorDashboardPage() {
    const session = await auth();

    if (!session?.user?.email) {
        redirect('/auth/signin?callbackUrl=/dashboard/vendor');
    }

    if (!session.user.roleSelected) {
        redirect('/auth/role-select?callbackUrl=/dashboard/vendor');
    }

    if (session.user.role === 'OWNER') {
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
