import { redirect } from 'next/navigation';
import { getOwnerDashboardInitial } from '@/actions/dashboard';
import OwnerDashboardClient from './OwnerDashboardClient';

export default async function OwnerDashboardPage() {
    const data = await getOwnerDashboardInitial();

    if (!data.userId) {
        redirect('/auth/signin?callbackUrl=/dashboard/owner');
    }
    if (data.role === 'VENDOR') {
        redirect('/dashboard/vendor');
    }

    // Serialize dates for the client boundary
    const initialLinks = JSON.parse(JSON.stringify(data.links));

    return (
        <OwnerDashboardClient
            initialLinks={initialLinks}
            initialUserId={data.userId}
        />
    );
}
