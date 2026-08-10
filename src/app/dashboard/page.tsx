import { redirect } from 'next/navigation';
import { auth } from '@/lib/auth';

/**
 * Server-side role redirect — avoids client session waterfall before navigating.
 */
export default async function DashboardPage() {
    const session = await auth();

    if (!session?.user) {
        redirect('/auth/signin?callbackUrl=/dashboard');
    }

    if (!session.user.roleSelected) {
        redirect('/auth/role-select?callbackUrl=/dashboard');
    }

    if (session.user.role === 'VENDOR') {
        redirect('/dashboard/vendor');
    }

    redirect('/dashboard/owner');
}
