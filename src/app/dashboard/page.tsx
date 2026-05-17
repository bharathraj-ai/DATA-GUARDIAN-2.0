'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { useEffect } from 'react';

export default function DashboardPage() {
    const router = useRouter();
    const { data: session, status: sessionStatus } = useSession();

    // Redirect to sign-in if not authenticated
    useEffect(() => {
        if (sessionStatus === 'unauthenticated') {
            router.push('/auth/signin?callbackUrl=/dashboard');
        }
    }, [sessionStatus, router]);

    const userRole = (session?.user as { role?: string })?.role as string | undefined;
    const roleSelected = (session?.user as any)?.roleSelected;

    // Auto-redirect based on role
    useEffect(() => {
        if (sessionStatus === 'authenticated') {
            // If role hasn't been selected yet, send to role-select
            if (!roleSelected) {
                router.push('/auth/role-select');
                return;
            }
            if (userRole === 'VENDOR') {
                router.push('/dashboard/vendor');
            } else {
                router.push('/dashboard/owner');
            }
        }
    }, [sessionStatus, userRole, roleSelected, router]);

    return (
        <main className="app-page">
            <section className="app-section">
                <div className="container">
                    <div className="app-container" style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '400px' }}>
                        <div style={{ textAlign: 'center' }}>
                            <div className="button-spinner" style={{ width: '48px', height: '48px', margin: '0 auto 16px' }}></div>
                            <p style={{ color: 'var(--text-secondary)' }}>Redirecting to your dashboard...</p>
                        </div>
                    </div>
                </div>
            </section>
        </main>
    );
}
