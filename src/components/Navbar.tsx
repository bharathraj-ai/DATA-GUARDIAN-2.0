'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState, useEffect } from 'react';
import { useSession, signOut } from 'next-auth/react';
import Image from 'next/image';

export default function Navbar() {
    const pathname = usePathname();
    const { data: session, status } = useSession();
    const [isScrolled, setIsScrolled] = useState(false);
    const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
    const [hasMounted, setHasMounted] = useState(false);

    useEffect(() => { setHasMounted(true); }, []);

    useEffect(() => {
        const handleScroll = () => {
            setIsScrolled(window.scrollY > 20);
        };
        window.addEventListener('scroll', handleScroll);
        return () => window.removeEventListener('scroll', handleScroll);
    }, []);

    const navLinks = [
        { name: 'Home', href: '/' },
        { name: 'How It Works', href: '/how-it-works' },
        { name: 'Services', href: '/services' },
    ];

    const isAuthenticated = status === 'authenticated' && session?.user;
    const userRole = (session?.user as { role?: string })?.role as string | undefined;
    const isOwnerSide = userRole === 'OWNER';
    const isVendorSide = userRole === 'VENDOR';
    const roleLabel = userRole === 'OWNER' ? 'Owner' : 'Vendor';

    return (
        <nav className={`navbar ${isScrolled ? 'navbar-scrolled' : ''}`}>
            <div className="container navbar-container">
                <Link href="/" className="navbar-logo">
                    <Image src="/logo.svg" alt="Secure Protocol" width={28} height={28} style={{ opacity: 0.9 }} />
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
                                {isOwnerSide && (
                                    <Link
                                        href="/dashboard/owner"
                                        className={`nav-link ${pathname?.startsWith('/dashboard/owner') ? 'active' : ''}`}
                                    >
                                        Owner
                                    </Link>
                                )}
                                {isVendorSide && (
                                    <Link
                                        href="/dashboard/vendor"
                                        className={`nav-link ${pathname?.startsWith('/dashboard/vendor') ? 'active' : ''}`}
                                    >
                                        Dashboard
                                    </Link>
                                )}
                                {isOwnerSide && (
                                    <Link href="/create-link" className="btn btn-primary btn-sm">
                                        Create Link
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
                                        <span className={`navbar-role-tag ${isOwnerSide ? 'navbar-role-tag--owner' : 'navbar-role-tag--vendor'}`}>
                                            {roleLabel}
                                        </span>
                                    </div>
                                    <button
                                        onClick={() => signOut({ callbackUrl: '/' })}
                                        className="btn btn-secondary btn-sm"
                                    >
                                        Sign Out
                                    </button>
                                </div>
                            </>
                    ) : (
                        <>
                            <Link href="/auth/signin" className="btn btn-secondary btn-sm">
                                Sign In
                            </Link>
                            <Link href="/create-link" className="btn btn-primary btn-sm">
                                Get Secure Link
                            </Link>
                        </>
                    )}
                </div>

                {/* Mobile menu button */}
                <button
                    className="navbar-mobile-toggle"
                    onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
                    aria-label={(hasMounted && isMobileMenuOpen) ? 'Close navigation menu' : 'Open navigation menu'}
                    aria-expanded={hasMounted && isMobileMenuOpen}
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
                <div className="navbar-menu-mobile">
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
                            {isOwnerSide && (
                                <Link
                                    href="/dashboard/owner"
                                    className={`nav-link-mobile ${pathname?.startsWith('/dashboard/owner') ? 'active' : ''}`}
                                    onClick={() => setIsMobileMenuOpen(false)}
                                >
                                    Owner Dashboard
                                </Link>
                            )}
                            {isVendorSide && (
                                <Link
                                    href="/dashboard/vendor"
                                    className={`nav-link-mobile ${pathname?.startsWith('/dashboard/vendor') ? 'active' : ''}`}
                                    onClick={() => setIsMobileMenuOpen(false)}
                                >
                                    Dashboard
                                </Link>
                            )}
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
                                            <p style={{ fontSize: '0.85rem', fontWeight: '600', color: 'var(--text-primary)' }}>
                                                {session?.user?.name || 'User'}
                                            </p>
                                            <span style={{
                                                fontSize: '0.65rem', fontWeight: '700', textTransform: 'uppercase',
                                                letterSpacing: '0.5px',
                                                padding: '2px 6px', borderRadius: '6px',
                                                background: isOwnerSide
                                                    ? 'linear-gradient(135deg, rgba(99,102,241,0.25), rgba(139,92,246,0.25))'
                                                    : 'rgba(20, 184, 166, 0.2)',
                                                color: isOwnerSide ? '#a78bfa' : '#14b8a6',
                                            }}>
                                                {roleLabel}
                                            </span>
                                        </div>
                                    </div>

                                    {isOwnerSide && (
                                        <Link
                                            href="/create-link"
                                            className="btn btn-primary btn-full"
                                            onClick={() => setIsMobileMenuOpen(false)}
                                        >
                                            Create Link
                                        </Link>
                                    )}
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
                        ) : (
                            <>
                                <Link
                                    href="/auth/signin"
                                    className="btn btn-secondary btn-full"
                                    onClick={() => setIsMobileMenuOpen(false)}
                                >
                                    Sign In
                                </Link>
                                <Link
                                    href="/create-link"
                                    className="btn btn-primary btn-full"
                                    onClick={() => setIsMobileMenuOpen(false)}
                                >
                                    Get Secure Link
                                </Link>
                            </>
                        )}
                    </div>
                </div>
            )}
        </nav>
    );
}
