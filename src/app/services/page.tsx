import Link from 'next/link';
import type { Metadata } from 'next';
import ScrollReveal from '@/components/ScrollReveal';

export const dynamic = 'force-static';

export const metadata: Metadata = {
    title: 'Services',
    description: 'Explore Secure Protocol services: zero-trust access, AES-256-GCM encrypted sharing, self-destructing links, OTP protection, instant revocation, and priority collaboration.',
};

export default function ServicesPage() {
    return (
        <main className="services-page">
            {/* Hero Section */}
            <section className="srv-hero-section">
                <div className="container srv-hero-container">
                    
                    {/* Left Illustration */}
                    <div className="srv-hero-illustration srv-hero-left">
                        <div className="srv-illustration-wrapper">
                            <div className="srv-folder srv-folder-back"></div>
                            <div className="srv-folder srv-folder-middle"></div>
                            <div className="srv-folder srv-folder-front">
                                <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                    <rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect>
                                    <path d="M7 11V7a5 5 0 0 1 10 0v4"></path>
                                </svg>
                            </div>
                        </div>
                    </div>

                    <div className="srv-hero-content">
                        <div className="brand-badge badge-center">
                            <span>POWERFUL FEATURES</span>
                        </div>
                        <h1 className="srv-hero-title">
                            Our <span className="gradient-text">Services</span>
                        </h1>
                        <p className="srv-hero-subtitle">
                            Enterprise-grade security features designed for everyone
                        </p>
                    </div>

                    {/* Right Illustration */}
                    <div className="srv-hero-illustration srv-hero-right">
                        <div className="srv-illustration-wrapper">
                            <div className="srv-shield-platform"></div>
                            <div className="srv-shield-body">
                                <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                    <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"></path>
                                    <path d="M12 8v4"></path>
                                    <path d="M12 16h.01"></path>
                                </svg>
                            </div>
                        </div>
                    </div>
                </div>
            </section>

            {/* Main Services Grid */}
            <section className="srv-main-section">
                <div className="container">
                    <div className="srv-services-grid">
                        
                        {/* Service 1 */}
                        <ScrollReveal delay={1}>
                            <div className="feature-card srv-service-card">
                                <div className="srv-card-icon-wrapper">
                                    <div className="srv-card-icon srv-icon-blue">
                                        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                            <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2v11z"></path>
                                        </svg>
                                    </div>
                                </div>
                                <h3 className="srv-card-title">Secure File Sharing</h3>
                                <p className="srv-card-desc">
                                    Share sensitive documents, images, and files with AES-256-GCM encryption at rest.
                                </p>
                                <ul className="srv-card-features">
                                    <li><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="20 6 9 17 4 12"></polyline></svg>Up to 15MB per file</li>
                                    <li><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="20 6 9 17 4 12"></polyline></svg>Multiple file formats supported</li>
                                    <li><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="20 6 9 17 4 12"></polyline></svg>Encryption at rest (AES-256-GCM)</li>
                                </ul>
                            </div>
                        </ScrollReveal>

                        {/* Service 2 */}
                        <ScrollReveal delay={2}>
                            <div className="feature-card srv-service-card">
                                <div className="srv-card-icon-wrapper">
                                    <div className="srv-card-icon srv-icon-green">
                                        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                            <circle cx="12" cy="12" r="10"></circle>
                                            <polyline points="12 6 12 12 16 14"></polyline>
                                        </svg>
                                    </div>
                                </div>
                                <h3 className="srv-card-title">Self-Destructing Links</h3>
                                <p className="srv-card-desc">
                                    Set custom expiration times for your secure links. Once the time expires, the link becomes permanently inaccessible.
                                </p>
                                <ul className="srv-card-features">
                                    <li><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="20 6 9 17 4 12"></polyline></svg>Custom expiration times</li>
                                    <li><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="20 6 9 17 4 12"></polyline></svg>Automatic data deletion</li>
                                    <li><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="20 6 9 17 4 12"></polyline></svg>Real-time countdown timer</li>
                                </ul>
                            </div>
                        </ScrollReveal>

                        {/* Service 3 */}
                        <ScrollReveal delay={3}>
                            <div className="feature-card srv-service-card">
                                <div className="srv-card-icon-wrapper">
                                    <div className="srv-card-icon srv-icon-orange">
                                        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                            <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"></path>
                                        </svg>
                                    </div>
                                </div>
                                <h3 className="srv-card-title">OTP Protection</h3>
                                <p className="srv-card-desc">
                                    Two-factor authentication with one-time passwords ensures only authorized recipients can access your data.
                                </p>
                                <ul className="srv-card-features">
                                    <li><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="20 6 9 17 4 12"></polyline></svg>6-digit secure OTP</li>
                                    <li><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="20 6 9 17 4 12"></polyline></svg>Separate from share link</li>
                                    <li><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="20 6 9 17 4 12"></polyline></svg>Prevents unauthorized access</li>
                                </ul>
                            </div>
                        </ScrollReveal>

                        {/* Service 4 */}
                        <ScrollReveal delay={1}>
                            <div className="feature-card srv-service-card">
                                <div className="srv-card-icon-wrapper">
                                    <div className="srv-card-icon srv-icon-pink">
                                        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                            <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"></path>
                                            <path d="M13.73 21a2 2 0 0 1-3.46 0"></path>
                                        </svg>
                                    </div>
                                </div>
                                <h3 className="srv-card-title">Instant Revocation</h3>
                                <p className="srv-card-desc">
                                    Maintain complete control with our kill switch feature. Revoke access instantly, even before the expiration time.
                                </p>
                                <ul className="srv-card-features">
                                    <li><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="20 6 9 17 4 12"></polyline></svg>One-click revocation</li>
                                    <li><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="20 6 9 17 4 12"></polyline></svg>Owner dashboard access</li>
                                    <li><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="20 6 9 17 4 12"></polyline></svg>Immediate effect</li>
                                </ul>
                            </div>
                        </ScrollReveal>

                        {/* Service 5 */}
                        <ScrollReveal delay={2}>
                            <div className="feature-card srv-service-card">
                                <div className="srv-card-icon-wrapper">
                                    <div className="srv-card-icon srv-icon-purple">
                                        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                            <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path>
                                            <circle cx="9" cy="7" r="4"></circle>
                                            <path d="M23 21v-2a4 4 0 0 0-3-3.87"></path>
                                            <path d="M16 3.13a4 4 0 0 1 0 7.75"></path>
                                        </svg>
                                    </div>
                                </div>
                                <h3 className="srv-card-title">Priority Collaboration</h3>
                                <p className="srv-card-desc">
                                    Multiple vendors can work in the same live session. Edit access follows assigned priority — higher levels can take over, others request without forcing.
                                </p>
                                <ul className="srv-card-features">
                                    <li><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="20 6 9 17 4 12"></polyline></svg>One live editor lock per file</li>
                                    <li><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="20 6 9 17 4 12"></polyline></svg>Higher-priority takeover</li>
                                    <li><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="20 6 9 17 4 12"></polyline></svg>Request-to-edit notifications</li>
                                </ul>
                            </div>
                        </ScrollReveal>

                        {/* Service 6 */}
                        <ScrollReveal delay={3}>
                            <div className="feature-card srv-service-card">
                                <div className="srv-card-icon-wrapper">
                                    <div className="srv-card-icon srv-icon-indigo">
                                        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                            <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"></path>
                                        </svg>
                                    </div>
                                </div>
                                <h3 className="srv-card-title">Encryption at Rest</h3>
                                <p className="srv-card-desc">
                                    Files are encrypted with AES-256-GCM before storage. After a zero-trust session check, the server unwraps keys for that request only. This is not zero-knowledge encryption.
                                </p>
                                <ul className="srv-card-features">
                                    <li><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="20 6 9 17 4 12"></polyline></svg>Per-file data keys</li>
                                    <li><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="20 6 9 17 4 12"></polyline></svg>No plaintext in object storage</li>
                                    <li><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="20 6 9 17 4 12"></polyline></svg>TLS in transit</li>
                                </ul>
                            </div>
                        </ScrollReveal>

                    </div>
                </div>
            </section>

            <section className="srv-gate">
                <div className="container srv-gate-grid">
                    <Link href="/create-link" className="srv-gate-panel">
                        <span>Open a share</span>
                        <strong>Encrypt and issue</strong>
                        <small>Timed link, OTP, and revoke from the owner desk.</small>
                    </Link>
                    <Link href="/how-it-works" className="srv-gate-panel srv-gate-panel-b">
                        <span>Read the protocol</span>
                        <strong>Issue · Seal · Unlock</strong>
                        <small>See the path a file takes before anyone can open it.</small>
                    </Link>
                </div>
            </section>
        </main>
    );
}

