import { auth } from '@/lib/auth';
import { redirect } from 'next/navigation';
import { Suspense } from 'react';
import RoleSelectClient from './RoleSelectClient';

interface Props {
    searchParams: Promise<{ callbackUrl?: string }> | { callbackUrl?: string };
}

function safeCallbackPath(raw: string | null | undefined): string | null {
    if (!raw || !raw.startsWith('/') || raw.startsWith('//')) return null;
    return raw;
}

export default async function RoleSelectPage({ searchParams }: Props) {
    const resolvedSearchParams = await searchParams;
    const callbackUrl = safeCallbackPath(resolvedSearchParams.callbackUrl);

    const session = await auth();

    // If user is not authenticated, redirect them to signin page
    if (!session?.user) {
        const signInUrl = callbackUrl
            ? `/auth/signin?callbackUrl=${encodeURIComponent(callbackUrl)}`
            : '/auth/signin';
        redirect(signInUrl);
    }

    // If user already selected a role, redirect them immediately on the server!
    if (session.user.roleSelected) {
        const role = session.user.role;
        const target = role === 'OWNER' ? (callbackUrl || '/dashboard/owner') : '/dashboard/vendor';
        redirect(target);
    }

    return (
        <Suspense fallback={
            <main className="app-page">
                <section className="app-section">
                    <div className="container">
                        <div className="app-container" style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '400px' }}>
                            <div style={{ textAlign: 'center' }}>
                                <div className="button-spinner" style={{ width: '48px', height: '48px', margin: '0 auto 16px' }}></div>
                                <p style={{ color: 'var(--color-text-secondary)' }}>Loading...</p>
                            </div>
                        </div>
                    </div>
                </section>
            </main>
        }>
            <RoleSelectClient callbackUrl={callbackUrl} session={session} />
        </Suspense>
    );
}
