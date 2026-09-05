'use client';

import Link from 'next/link';
import { ArrowRight, Shield } from 'lucide-react';
import { useDeferredMarketingSession } from '@/components/useDeferredMarketingSession';
import { canCreateSecureLinks, dashboardPathForRole, normalizeRole, roleDisplayName } from '@/lib/security/role-helpers';

/**
 * Light-theme hero CTA.
 * New users → join + role select. Signed-in users → their dashboard
 * after a deferred session check (no SessionProvider on the landing tree).
 */
export default function HeroActions() {
    const { session, status } = useDeferredMarketingSession();
    const isAuthed = status === 'authenticated' && session?.user;
    const role = normalizeRole(session?.user?.role);
    const onboardingDone =
        session?.user?.onboardingStep === 'COMPLETE' ||
        (session?.user?.onboardingStep == null && session?.user?.roleSelected);

    if (isAuthed && onboardingDone) {
        const href = dashboardPathForRole(role);
        const label = roleDisplayName(role).toLowerCase();
        return (
            <div className="hero-actions">
                <Link href={href} className="dg-launch">
                    <span className="dg-launch-icon">
                        <Shield size={20} strokeWidth={2.2} />
                    </span>
                    <span className="dg-launch-copy">
                        <span className="dg-launch-label">Welcome back</span>
                        <span className="dg-launch-title">
                            Open your {canCreateSecureLinks(role) ? 'team leader' : label} dashboard
                        </span>
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
