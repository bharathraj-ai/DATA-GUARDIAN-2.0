'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ArrowRight, Shield } from 'lucide-react';
import { useDeferredMarketingSession } from '@/components/useDeferredMarketingSession';
import { canCreateSecureLinks } from '@/lib/security/role-helpers';

/**
 * Landing CTA. Session is deferred so first paint is not blocked on /api/auth/session.
 */
export default function HeroActions() {
    const pathname = usePathname();
    const { session, status } = useDeferredMarketingSession(pathname);
    const isAuthed = status === 'authenticated' && session?.user;
    const isOwner = canCreateSecureLinks(session?.user?.role);
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
                    <span className="dg-launch-label">New to Secure Protocol</span>
                    <span className="dg-launch-title">Start sharing your data</span>
                </span>
                <span className="dg-launch-go" aria-hidden="true">
                    <ArrowRight size={18} />
                </span>
            </Link>
        </div>
    );
}
