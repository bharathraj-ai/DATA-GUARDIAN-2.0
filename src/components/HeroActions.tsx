'use client';

import Link from 'next/link';
import { useSession } from 'next-auth/react';
import { ArrowRight, Shield } from 'lucide-react';

/**
 * Light-theme hero CTA.
 * New users → join + role select. Signed-in users → their dashboard.
 * Existing logged-out users use header Sign In.
 */
export default function HeroActions() {
    const { data: session, status } = useSession();
    const isAuthed = status === 'authenticated' && session?.user;
    const isOwner = session?.user?.role === 'OWNER';
    const onboardingDone =
        session?.user?.onboardingStep === 'COMPLETE' ||
        (session?.user?.onboardingStep == null && session?.user?.roleSelected);

    if (isAuthed && onboardingDone) {
        const href = isOwner ? '/dashboard/owner' : '/dashboard/vendor';
        return (
            <div className="hero-actions">
                <Link href={href} className="dg-launch">
                    <span className="dg-launch-icon">
                        <Shield size={20} strokeWidth={2.2} />
                    </span>
                    <span className="dg-launch-copy">
                        <span className="dg-launch-label">Welcome back</span>
                        <span className="dg-launch-title">Open your {isOwner ? 'owner' : 'vendor'} dashboard</span>
                    </span>
                    <span className="dg-launch-go" aria-hidden="true">
                        <ArrowRight size={18} />
                    </span>
                </Link>
            </div>
        );
    }

    return (
        <div className="hero-actions">
            <Link href="/auth/signin?intent=join" className="dg-launch">
                <span className="dg-launch-icon">
                    <Shield size={20} strokeWidth={2.2} />
                </span>
                <span className="dg-launch-copy">
                    <span className="dg-launch-label">New to Data Guardian</span>
                    <span className="dg-launch-title">Start sharing your data</span>
                </span>
                <span className="dg-launch-go" aria-hidden="true">
                    <ArrowRight size={18} />
                </span>
            </Link>
        </div>
    );
}
