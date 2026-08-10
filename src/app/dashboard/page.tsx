import { redirect } from 'next/navigation';
import { auth } from '@/lib/auth';

export default async function DashboardPage() {
    const session = await auth();
    if (!session?.user) {
        redirect('/auth/signin?callbackUrl=/dashboard');
    }

    const roleSelected = (session.user as { roleSelected?: boolean }).roleSelected;
    if (!roleSelected) {
        redirect('/auth/role-select');
    }

    const role = (session.user as { role?: string }).role;
    redirect(role === 'VENDOR' ? '/dashboard/vendor' : '/dashboard/owner');
}
