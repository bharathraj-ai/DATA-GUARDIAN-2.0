import Link from 'next/link';
import type { Metadata } from 'next';
import ScrollReveal from '@/components/ScrollReveal';

export const metadata: Metadata = {
    title: 'Services',
    description: 'Explore Secure Protocol services: AES-256 encrypted sharing, self-destructing links, OTP protection, instant revocation, QR code delivery, and zero-knowledge architecture.',
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
                                    Share sensitive documents, images, and files with military-grade encryption.
                                </p>
                                <ul className="srv-card-features">
                                    <li><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="20 6 9 17 4 12"></polyline></svg>Up to 15MB per file</li>
                                    <li><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="20 6 9 17 4 12"></polyline></svg>Multiple file formats supported</li>
                                    <li><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="20 6 9 17 4 12"></polyline></svg>End-to-end encryption</li>
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
                                            <rect x="3" y="3" width="7" height="7"></rect>
                                            <rect x="14" y="3" width="7" height="7"></rect>
                                            <rect x="14" y="14" width="7" height="7"></rect>
                                            <rect x="3" y="14" width="7" height="7"></rect>
                                        </svg>
                                    </div>
                                </div>
                                <h3 className="srv-card-title">QR Code Generation</h3>
                                <p className="srv-card-desc">
                                    Automatically generate QR codes for every secure link. Perfect for mobile sharing, presentations, or quick access scenarios.
                                </p>
                                <ul className="srv-card-features">
                                    <li><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="20 6 9 17 4 12"></polyline></svg>Auto-generated QR codes</li>
                                    <li><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="20 6 9 17 4 12"></polyline></svg>Mobile-optimized scanning</li>
                                    <li><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="20 6 9 17 4 12"></polyline></svg>Downloadable QR images</li>
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
                                <h3 className="srv-card-title">Zero-Knowledge Architecture</h3>
                                <p className="srv-card-desc">
                                    We never store your unencrypted data. All encryption happens on your device before transmission.
                                </p>
                                <ul className="srv-card-features">
                                    <li><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="20 6 9 17 4 12"></polyline></svg>Client-side encryption</li>
                                    <li><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="20 6 9 17 4 12"></polyline></svg>No plaintext storage</li>
                                    <li><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="20 6 9 17 4 12"></polyline></svg>GDPR compliant</li>
                                </ul>
                            </div>
                        </ScrollReveal>

                    </div>
                </div>
            </section>

            {/* CTA Section */}
            <section className="srv-cta-section">
                <div className="container">
                    <ScrollReveal>
                        <div className="srv-cta-card">
                            <div className="srv-cta-content">
                                <div className="brand-badge badge-left">
                                    <span>GET STARTED TODAY</span>
                                </div>
                                <h2 className="srv-cta-title">Ready to Protect Your Data?</h2>
                                <p className="srv-cta-subtitle">
                                    Start using Secure Protocol today.<br />No registration required.
                                </p>
                                <div className="srv-cta-buttons">
                                    <Link href="/create-link" className="btn btn-primary btn-large">
                                        <span>Create Secure Link</span>
                                        <svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor">
                                            <path fillRule="evenodd" d="M10.293 3.293a1 1 0 011.414 0l6 6a1 1 0 010 1.414l-6 6a1 1 0 01-1.414-1.414L14.586 11H3a1 1 0 110-2h11.586l-4.293-4.293a1 1 0 010-1.414z" clipRule="evenodd" />
                                        </svg>
                                    </Link>
                                    <Link href="/how-it-works" className="btn btn-outline-light btn-large">
                                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                            <circle cx="12" cy="12" r="10"></circle>
                                            <line x1="12" y1="16" x2="12" y2="12"></line>
                                            <line x1="12" y1="8" x2="12.01" y2="8"></line>
                                        </svg>
                                        <span>Learn More</span>
                                    </Link>
                                </div>
                            </div>
                            
                            <div className="srv-cta-visual">
                                <div className="srv-orbit-system">
                                    <div className="srv-orbit-center">
                                        <div className="srv-shield-glow"></div>
                                        <svg width="128" height="128" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" style={{position: 'relative', zIndex: 10}}>
                                            <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" stroke="#2563eb" strokeWidth="1.5" fill="#eff6ff" strokeLinecap="round" strokeLinejoin="round"/>
                                            <path d="M12 2v20" stroke="#2563eb" strokeWidth="1"/>
                                            <path d="M4.5 11h15" stroke="#2563eb" strokeWidth="1"/>
                                            <path d="M12 2v9h7.5" fill="#60a5fa" opacity="0.5"/>
                                            <path d="M4.5 11h7.5v11" fill="#3b82f6" opacity="0.5"/>
                                        </svg>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </ScrollReveal>
                </div>
            </section>
        </main>
    );
}

