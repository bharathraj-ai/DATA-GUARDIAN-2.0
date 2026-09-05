'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useState, useEffect } from 'react';
import { useSession, signOut } from 'next-auth/react';
import Image from 'next/image';
import { isMarketingPath } from '@/lib/marketing-paths';
import { useDeferredMarketingSession } from '@/components/useDeferredMarketingSession';
import {
    canCreateSecureLinks,
    dashboardPathForRole,
    normalizeRole,
    roleDisplayName,
} from '@/lib/security/role-helpers';

type NavSession = {
    user?: {
        name?: string | null;
        image?: string | null;
        role?: string | null;
        onboardingStep?: string | null;
        roleSelected?: boolean | null;
        organizationId?: string | null;
    } | null;
} | null;

export default function Navbar() {
    const pathname = usePathname();
    if (isMarketingPath(pathname)) {
        return <MarketingNavbar />;
    }
    return <AppNavbar />;
}

function MarketingNavbar() {
    const { session, status } = useDeferredMarketingSession();
    return <NavbarView session={session} status={status} />;
}

function AppNavbar() {
    const { data: session, status } = useSession();
    return <NavbarView session={session} status={status} />;
}

function NavbarView({
    session,
    status,
}: {
    session: NavSession;
    status: string;
}) {
    const pathname = usePathname();
    const router = useRouter();
    const [isScrolled, setIsScrolled] = useState(false);
    const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
    const [hasMounted, setHasMounted] = useState(false);

    useEffect(() => { setHasMounted(true); }, []);

    useEffect(() => {
        setIsMobileMenuOpen(false);
    }, [pathname]);

    useEffect(() => {
        if (!isMobileMenuOpen) return;
        const prevOverflow = document.body.style.overflow;
        document.body.style.overflow = 'hidden';
        const onKey = (e: KeyboardEvent) => {
            if (e.key === 'Escape') setIsMobileMenuOpen(false);
        };
        window.addEventListener('keydown', onKey);
        return () => {
            document.body.style.overflow = prevOverflow;
            window.removeEventListener('keydown', onKey);
        };
    }, [isMobileMenuOpen]);

    useEffect(() => {
        const handleScroll = () => {
            setIsScrolled(window.scrollY > 20);
        };
        window.addEventListener('scroll', handleScroll, { passive: true });
        return () => window.removeEventListener('scroll', handleScroll);
    }, []);

    // Prefetch authenticated destinations so nav feels instant
    useEffect(() => {
        if (status !== 'authenticated') return;
        const roleReady =
            session?.user?.onboardingStep === 'COMPLETE' ||
            (session?.user?.onboardingStep == null && Boolean(session?.user?.roleSelected));
        const role = session?.user?.role;
        router.prefetch('/how-it-works');
        router.prefetch('/services');
        if (!roleReady) return;
        const path = dashboardPathForRole(role);
        router.prefetch(path);
        router.prefetch('/settings');
        router.prefetch('/help');
        if (canCreateSecureLinks(role)) {
            router.prefetch('/create-link');
        }
    }, [status, session, router]);

    const navLinks = [
        { name: 'Home', href: '/' },
        { name: 'How It Works', href: '/how-it-works' },
        { name: 'Services', href: '/services' },
    ];

    const isAuthenticated = status === 'authenticated' && session?.user;
    const onboardingComplete =
        session?.user?.onboardingStep === 'COMPLETE' ||
        (session?.user?.onboardingStep == null && Boolean(session?.user?.roleSelected));
    const userRole = normalizeRole(session?.user?.role);
    const dashHref = dashboardPathForRole(userRole);
    const isVendorSide = onboardingComplete && userRole === 'VENDOR';
    const isLeaderSide = onboardingComplete && canCreateSecureLinks(userRole);
    const roleLabel = onboardingComplete ? roleDisplayName(userRole) : null;
    const dashLabel =
        userRole === 'VENDOR'
            ? 'Dashboard'
            : 'Owner';

    return (
        <nav className={`navbar ${isScrolled ? 'navbar-scrolled' : ''}`}>
            <div className="container navbar-container">
                <Link href="/" className="navbar-logo">
                    <Image src="/logo.jpg" alt="Secure Protocol" width={32} height={32} style={{ opacity: 0.9, borderRadius: '4px' }} />
                    <span style={{ fontWeight: 600, letterSpacing: '-0.02em', fontSize: '18px' }}>Secure Protocol</span>
                </Link>

                {/* Desktop Menu */}
                <div className="navbar-menu-desktop">
                    {navLinks.map((link) => (
                        <Link
                            key={link.href}
                            href={link.href}
                            className={`nav-link ${pathname === link.href ? 'active' : ''}`}
                        >
                            {link.name}
                        </Link>
                    ))}

                    {isAuthenticated ? (
                            <>
                                {(isLeaderSide || isVendorSide) && (
                                    <Link
                                        href={dashHref}
                                        className={`nav-link ${pathname?.startsWith('/dashboard') ? 'active' : ''}`}
                                    >
                                        {dashLabel}
                                    </Link>
                                )}


                                {/* Profile Badge with Role */}
                                <div className="navbar-profile-wrapper">
                                    <div className="navbar-profile-badge">
                                        {session?.user?.image ? (
                                            <Image
                                                src={session.user.image}
                                                alt={`${session?.user?.name || 'User'} profile`}
                                                width={32}
                                                height={32}
                                                className="navbar-avatar"
                                                referrerPolicy="no-referrer"
                                                unoptimized={false}
                                            />
                                        ) : (
                                            <div className="navbar-avatar-fallback" aria-hidden="true">
                                                {session?.user?.name?.[0]?.toUpperCase() || '?'}
                                            </div>
                                        )}
                                        {roleLabel ? (
                                            <span className={`navbar-role-tag ${isLeaderSide ? 'navbar-role-tag--owner' : 'navbar-role-tag--vendor'}`}>
                                                {roleLabel}
                                            </span>
                                        ) : pathname !== '/auth/role-select' ? (
                                            <Link href="/auth/role-select" className="navbar-role-tag navbar-role-tag--pending">
                                                Choose role
                                            </Link>
                                        ) : null}
                                    </div>
                                    <button
                                        onClick={() => signOut({ callbackUrl: '/' })}
                                        className="btn btn-secondary btn-sm"
                                    >
                                        Sign Out
                                    </button>
                                </div>
                            </>
                    ) : pathname?.startsWith('/auth/signin') ? null : (
                        <Link
                            href="/auth/signin?intent=returning&callbackUrl=/dashboard"
                            className="btn btn-secondary btn-sm"
                        >
                            Sign In
                        </Link>
                    )}
                </div>

                {/* Mobile menu button */}
                <button
                    type="button"
                    className="navbar-mobile-toggle"
                    onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
                    aria-label={(hasMounted && isMobileMenuOpen) ? 'Close navigation menu' : 'Open navigation menu'}
                    aria-expanded={hasMounted && isMobileMenuOpen}
                    aria-controls="navbar-mobile-drawer"
                >
                    {(hasMounted && isMobileMenuOpen) ? (
                        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <line x1="18" y1="6" x2="6" y2="18"></line>
                            <line x1="6" y1="6" x2="18" y2="18"></line>
                        </svg>
                    ) : (
                        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <line x1="3" y1="12" x2="21" y2="12"></line>
                            <line x1="3" y1="6" x2="21" y2="6"></line>
                            <line x1="3" y1="18" x2="21" y2="18"></line>
                        </svg>
                    )}
                </button>
            </div>

            {/* Mobile Menu */}
            {isMobileMenuOpen && (
                <>
                <button
                    type="button"
                    className="navbar-drawer-overlay"
                    aria-label="Close navigation menu"
                    onClick={() => setIsMobileMenuOpen(false)}
                />
                <div
                    id="navbar-mobile-drawer"
                    className="navbar-menu-mobile"
                    role="dialog"
                    aria-modal="true"
                    aria-label="Site navigation"
                >
                    <div className="navbar-drawer-head">
                        <span>Menu</span>
                        <button
                            type="button"
                            className="navbar-drawer-close"
                            onClick={() => setIsMobileMenuOpen(false)}
                            aria-label="Close navigation menu"
                        >
                            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                                <line x1="18" y1="6" x2="6" y2="18"></line>
                                <line x1="6" y1="6" x2="18" y2="18"></line>
                            </svg>
                        </button>
                    </div>
                    {navLinks.map((link) => (
                        <Link
                            key={link.href}
                            href={link.href}
                            className={`nav-link-mobile ${pathname === link.href ? 'active' : ''}`}
                            onClick={() => setIsMobileMenuOpen(false)}
                        >
                            {link.name}
                        </Link>
                    ))}

                    {isAuthenticated && (
                        <>
                            {(isLeaderSide || isVendorSide) && (
                                <Link
                                    href={dashHref}
                                    className={`nav-link-mobile ${pathname?.startsWith('/dashboard') ? 'active' : ''}`}
                                    onClick={() => setIsMobileMenuOpen(false)}
                                >
                                    {dashLabel}
                                </Link>
                            )}


                            <Link
                                href="/help"
                                className="nav-link-mobile"
                                onClick={() => setIsMobileMenuOpen(false)}
                            >
                                Help
                            </Link>
                        </>
                    )}

                    <div className="navbar-mobile-cta">
                        {isAuthenticated ? (
                                <>
                                    {/* Mobile Profile Badge */}
                                    <div style={{
                                        display: 'flex', alignItems: 'center', gap: '10px',
                                        padding: '10px 14px', borderRadius: '12px',
                                        background: 'rgba(255,255,255,0.04)',
                                        border: '1px solid rgba(255,255,255,0.08)',
                                        marginBottom: '8px',
                                    }}>
                                        {session?.user?.image ? (
                                            <img
                                                src={session.user.image}
                                                alt="Profile"
                                                width={32}
                                                height={32}
                                                style={{ width: '32px', height: '32px', borderRadius: '50%' }}
                                                referrerPolicy="no-referrer"
                                            />
                                        ) : (
                                            <div style={{
                                                width: '32px', height: '32px', borderRadius: '50%',
                                                background: 'linear-gradient(135deg, var(--primary-blue), var(--accent-purple))',
                                                display: 'flex', alignItems: 'center', justifyContent: 'center',
                                                fontSize: '0.85rem', fontWeight: '700', color: '#fff',
                                            }}>
                                                {session?.user?.name?.[0]?.toUpperCase() || '?'}
                                            </div>
                                        )}
                                        <div style={{ flex: 1 }}>
                                            <p style={{ fontSize: '0.85rem', fontWeight: '600', color: '#0F172A' }}>
                                                {session?.user?.name || 'User'}
                                            </p>
                                            {roleLabel ? (
                                            <span style={{
                                                fontSize: '0.65rem', fontWeight: '700', textTransform: 'uppercase',
                                                letterSpacing: '0.5px',
                                                padding: '2px 6px', borderRadius: '6px',
                                                background: isLeaderSide
                                                    ? 'linear-gradient(135deg, rgba(99,102,241,0.25), rgba(139,92,246,0.25))'
                                                    : 'rgba(20, 184, 166, 0.2)',
                                                color: isLeaderSide ? '#a78bfa' : '#14b8a6',
                                            }}>
                                                {roleLabel}
                                            </span>
                                            ) : (
                                            <Link
                                                href="/auth/role-select"
                                                onClick={() => setIsMobileMenuOpen(false)}
                                                style={{
                                                    fontSize: '0.65rem', fontWeight: '700', textTransform: 'uppercase',
                                                    letterSpacing: '0.5px',
                                                    padding: '2px 6px', borderRadius: '6px',
                                                    background: '#E0F2FE',
                                                    color: '#0284c7',
                                                    textDecoration: 'none',
                                                }}
                                            >
                                                Choose role
                                            </Link>
                                            )}
                                        </div>
                                    </div>

                                    <button
                                        onClick={() => {
                                            setIsMobileMenuOpen(false);
                                            signOut({ callbackUrl: '/' });
                                        }}
                                        className="btn btn-secondary btn-full"
                                    >
                                        Sign Out
                                    </button>
                                </>
                        ) : pathname?.startsWith('/auth/signin') ? null : (
                            <Link
                                href="/auth/signin?intent=returning&callbackUrl=/dashboard"
                                className="btn btn-secondary btn-full"
                                onClick={() => setIsMobileMenuOpen(false)}
                            >
                                Sign In
                            </Link>
                        )}
                    </div>
                </div>
                </>
            )}
        </nav>
    );
}
