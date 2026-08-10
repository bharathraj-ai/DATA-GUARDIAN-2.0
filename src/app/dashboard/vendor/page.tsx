import { redirect } from 'next/navigation';
import { getVendorDashboardInitial } from '@/actions/dashboard';
import VendorDashboardClient from './VendorDashboardClient';

export default async function VendorDashboardPage() {
    const data = await getVendorDashboardInitial();

    if (!data.email) {
        redirect('/auth/signin?callbackUrl=/dashboard/vendor');
    }

    const initialLinks = JSON.parse(JSON.stringify(data.links));

    return (
        <VendorDashboardClient
            initialLinks={initialLinks}
            initialEmail={data.email}
        />
    );
}
