import Link from 'next/link';

export default function ServicesPage() {
    return (
        <main className="services-page">
            {/* Hero Section */}
            <section className="services-hero-section">
                <div className="container">
                    <div className="services-hero-content">
                        <h1 className="services-hero-title">
                            Our <span className="gradient-text">Services</span>
                        </h1>
                        <p className="services-hero-subtitle">
                            Enterprise-grade security features designed for everyone
                        </p>
                    </div>
                </div>
            </section>

            {/* Main Services */}
            <section className="main-services-section">
                <div className="container">
                    <div className="services-grid-large">
                        {/* Service 1 */}
                        <div className="service-card-large">
                            <div className="service-card-header">
                                <div className="service-card-icon service-card-icon-blue">
                                    <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                        <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"></path>
                                        <polyline points="3.27 6.96 12 12.01 20.73 6.96"></polyline>
                                        <line x1="12" y1="22.08" x2="12" y2="12"></line>
                                    </svg>
                                </div>
                                <div className="service-card-badge">Core Feature</div>
                            </div>
                            <h3 className="service-card-title">Secure File Sharing</h3>
                            <p className="service-card-description">
                                Share sensitive documents, images, and files with military-grade encryption.
                                Support for multiple file formats including PDF, Excel, images, and more.
                                Each file is encrypted individually and can only be accessed with the correct OTP.
                            </p>
                            <div className="service-card-features">
                                <div className="service-feature-item">
                                    <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
                                        <path d="M10.97 4.97a.75.75 0 0 1 1.07 1.05l-3.99 4.99a.75.75 0 0 1-1.08.02L4.324 8.384a.75.75 0 1 1 1.06-1.06l2.094 2.093 3.473-4.425a.267.267 0 0 1 .02-.022z" />
                                    </svg>
                                    <span>Up to 15MB per file</span>
                                </div>
                                <div className="service-feature-item">
                                    <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
                                        <path d="M10.97 4.97a.75.75 0 0 1 1.07 1.05l-3.99 4.99a.75.75 0 0 1-1.08.02L4.324 8.384a.75.75 0 1 1 1.06-1.06l2.094 2.093 3.473-4.425a.267.267 0 0 1 .02-.022z" />
                                    </svg>
                                    <span>Multiple file formats supported</span>
                                </div>
                                <div className="service-feature-item">
                                    <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
                                        <path d="M10.97 4.97a.75.75 0 0 1 1.07 1.05l-3.99 4.99a.75.75 0 0 1-1.08.02L4.324 8.384a.75.75 0 1 1 1.06-1.06l2.094 2.093 3.473-4.425a.267.267 0 0 1 .02-.022z" />
                                    </svg>
                                    <span>End-to-end encryption</span>
                                </div>
                            </div>
                        </div>

                        {/* Service 2 */}
                        <div className="service-card-large">
                            <div className="service-card-header">
                                <div className="service-card-icon service-card-icon-cyan">
                                    <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                        <circle cx="12" cy="12" r="10"></circle>
                                        <polyline points="12 6 12 12 16 14"></polyline>
                                    </svg>
                                </div>
                                <div className="service-card-badge">Time-Based</div>
                            </div>
                            <h3 className="service-card-title">Self-Destructing Links</h3>
                            <p className="service-card-description">
                                Set custom expiration times for your secure links. Once the time expires,
                                the link becomes permanently inaccessible. Perfect for time-sensitive information
                                that should only be available for a limited period.
                            </p>
                            <div className="service-card-features">
                                <div className="service-feature-item">
                                    <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
                                        <path d="M10.97 4.97a.75.75 0 0 1 1.07 1.05l-3.99 4.99a.75.75 0 0 1-1.08.02L4.324 8.384a.75.75 0 1 1 1.06-1.06l2.094 2.093 3.473-4.425a.267.267 0 0 1 .02-.022z" />
                                    </svg>
                                    <span>Custom expiration times</span>
                                </div>
                                <div className="service-feature-item">
                                    <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
                                        <path d="M10.97 4.97a.75.75 0 0 1 1.07 1.05l-3.99 4.99a.75.75 0 0 1-1.08.02L4.324 8.384a.75.75 0 1 1 1.06-1.06l2.094 2.093 3.473-4.425a.267.267 0 0 1 .02-.022z" />
                                    </svg>
                                    <span>Automatic data deletion</span>
                                </div>
                                <div className="service-feature-item">
                                    <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
                                        <path d="M10.97 4.97a.75.75 0 0 1 1.07 1.05l-3.99 4.99a.75.75 0 0 1-1.08.02L4.324 8.384a.75.75 0 1 1 1.06-1.06l2.094 2.093 3.473-4.425a.267.267 0 0 1 .02-.022z" />
                                    </svg>
                                    <span>Real-time countdown timer</span>
                                </div>
                            </div>
                        </div>

                        {/* Service 3 */}
                        <div className="service-card-large">
                            <div className="service-card-header">
                                <div className="service-card-icon service-card-icon-purple">
                                    <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                        <rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect>
                                        <path d="M7 11V7a5 5 0 0 1 10 0v4"></path>
                                    </svg>
                                </div>
                                <div className="service-card-badge">Authentication</div>
                            </div>
                            <h3 className="service-card-title">OTP Protection</h3>
                            <p className="service-card-description">
                                Two-factor authentication with one-time passwords ensures only authorized
                                recipients can access your data. The OTP is generated separately from the link,
                                providing an additional layer of security against unauthorized access.
                            </p>
                            <div className="service-card-features">
                                <div className="service-feature-item">
                                    <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
                                        <path d="M10.97 4.97a.75.75 0 0 1 1.07 1.05l-3.99 4.99a.75.75 0 0 1-1.08.02L4.324 8.384a.75.75 0 1 1 1.06-1.06l2.094 2.093 3.473-4.425a.267.267 0 0 1 .02-.022z" />
                                    </svg>
                                    <span>6-digit secure OTP</span>
                                </div>
                                <div className="service-feature-item">
                                    <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
                                        <path d="M10.97 4.97a.75.75 0 0 1 1.07 1.05l-3.99 4.99a.75.75 0 0 1-1.08.02L4.324 8.384a.75.75 0 1 1 1.06-1.06l2.094 2.093 3.473-4.425a.267.267 0 0 1 .02-.022z" />
                                    </svg>
                                    <span>Separate from share link</span>
                                </div>
                                <div className="service-feature-item">
                                    <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
                                        <path d="M10.97 4.97a.75.75 0 0 1 1.07 1.05l-3.99 4.99a.75.75 0 0 1-1.08.02L4.324 8.384a.75.75 0 1 1 1.06-1.06l2.094 2.093 3.473-4.425a.267.267 0 0 1 .02-.022z" />
                                    </svg>
                                    <span>Prevents unauthorized access</span>
                                </div>
                            </div>
                        </div>

                        {/* Service 4 */}
                        <div className="service-card-large">
                            <div className="service-card-header">
                                <div className="service-card-icon service-card-icon-green">
                                    <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                        <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"></path>
                                        <path d="M13.73 21a2 2 0 0 1-3.46 0"></path>
                                    </svg>
                                </div>
                                <div className="service-card-badge">Control</div>
                            </div>
                            <h3 className="service-card-title">Instant Revocation</h3>
                            <p className="service-card-description">
                                Maintain complete control with our kill switch feature. Revoke access to your
                                shared data instantly, even before the expiration time. Perfect for situations
                                where you need to immediately restrict access to sensitive information.
                            </p>
                            <div className="service-card-features">
                                <div className="service-feature-item">
                                    <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
                                        <path d="M10.97 4.97a.75.75 0 0 1 1.07 1.05l-3.99 4.99a.75.75 0 0 1-1.08.02L4.324 8.384a.75.75 0 1 1 1.06-1.06l2.094 2.093 3.473-4.425a.267.267 0 0 1 .02-.022z" />
                                    </svg>
                                    <span>One-click revocation</span>
                                </div>
                                <div className="service-feature-item">
                                    <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
                                        <path d="M10.97 4.97a.75.75 0 0 1 1.07 1.05l-3.99 4.99a.75.75 0 0 1-1.08.02L4.324 8.384a.75.75 0 1 1 1.06-1.06l2.094 2.093 3.473-4.425a.267.267 0 0 1 .02-.022z" />
                                    </svg>
                                    <span>Owner dashboard access</span>
                                </div>
                                <div className="service-feature-item">
                                    <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
                                        <path d="M10.97 4.97a.75.75 0 0 1 1.07 1.05l-3.99 4.99a.75.75 0 0 1-1.08.02L4.324 8.384a.75.75 0 1 1 1.06-1.06l2.094 2.093 3.473-4.425a.267.267 0 0 1 .02-.022z" />
                                    </svg>
                                    <span>Immediate effect</span>
                                </div>
                            </div>
                        </div>

                        {/* Service 5 */}
                        <div className="service-card-large">
                            <div className="service-card-header">
                                <div className="service-card-icon service-card-icon-orange">
                                    <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                        <rect x="2" y="7" width="20" height="14" rx="2" ry="2"></rect>
                                        <path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"></path>
                                    </svg>
                                </div>
                                <div className="service-card-badge">Mobile-Friendly</div>
                            </div>
                            <h3 className="service-card-title">QR Code Generation</h3>
                            <p className="service-card-description">
                                Automatically generate QR codes for every secure link. Perfect for mobile sharing,
                                presentations, or quick access scenarios. Recipients can simply scan the QR code
                                with their smartphone to access the secure link instantly.
                            </p>
                            <div className="service-card-features">
                                <div className="service-feature-item">
                                    <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
                                        <path d="M10.97 4.97a.75.75 0 0 1 1.07 1.05l-3.99 4.99a.75.75 0 0 1-1.08.02L4.324 8.384a.75.75 0 1 1 1.06-1.06l2.094 2.093 3.473-4.425a.267.267 0 0 1 .02-.022z" />
                                    </svg>
                                    <span>Auto-generated QR codes</span>
                                </div>
                                <div className="service-feature-item">
                                    <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
                                        <path d="M10.97 4.97a.75.75 0 0 1 1.07 1.05l-3.99 4.99a.75.75 0 0 1-1.08.02L4.324 8.384a.75.75 0 1 1 1.06-1.06l2.094 2.093 3.473-4.425a.267.267 0 0 1 .02-.022z" />
                                    </svg>
                                    <span>Mobile-optimized scanning</span>
                                </div>
                                <div className="service-feature-item">
                                    <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
                                        <path d="M10.97 4.97a.75.75 0 0 1 1.07 1.05l-3.99 4.99a.75.75 0 0 1-1.08.02L4.324 8.384a.75.75 0 1 1 1.06-1.06l2.094 2.093 3.473-4.425a.267.267 0 0 1 .02-.022z" />
                                    </svg>
                                    <span>Downloadable QR images</span>
                                </div>
                            </div>
                        </div>

                        {/* Service 6 */}
                        <div className="service-card-large">
                            <div className="service-card-header">
                                <div className="service-card-icon service-card-icon-pink">
                                    <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                        <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"></path>
                                    </svg>
                                </div>
                                <div className="service-card-badge">Privacy</div>
                            </div>
                            <h3 className="service-card-title">Zero-Knowledge Architecture</h3>
                            <p className="service-card-description">
                                We never store your unencrypted data. All encryption happens on your device
                                before transmission. Even we cannot access your shared information, ensuring
                                complete privacy and compliance with data protection regulations.
                            </p>
                            <div className="service-card-features">
                                <div className="service-feature-item">
                                    <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
                                        <path d="M10.97 4.97a.75.75 0 0 1 1.07 1.05l-3.99 4.99a.75.75 0 0 1-1.08.02L4.324 8.384a.75.75 0 1 1 1.06-1.06l2.094 2.093 3.473-4.425a.267.267 0 0 1 .02-.022z" />
                                    </svg>
                                    <span>Client-side encryption</span>
                                </div>
                                <div className="service-feature-item">
                                    <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
                                        <path d="M10.97 4.97a.75.75 0 0 1 1.07 1.05l-3.99 4.99a.75.75 0 0 1-1.08.02L4.324 8.384a.75.75 0 1 1 1.06-1.06l2.094 2.093 3.473-4.425a.267.267 0 0 1 .02-.022z" />
                                    </svg>
                                    <span>No plaintext storage</span>
                                </div>
                                <div className="service-feature-item">
                                    <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
                                        <path d="M10.97 4.97a.75.75 0 0 1 1.07 1.05l-3.99 4.99a.75.75 0 0 1-1.08.02L4.324 8.384a.75.75 0 1 1 1.06-1.06l2.094 2.093 3.473-4.425a.267.267 0 0 1 .02-.022z" />
                                    </svg>
                                    <span>GDPR compliant</span>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </section>

            {/* CTA Section */}
            <section className="services-cta-section">
                <div className="container">
                    <div className="services-cta-card">
                        <h2 className="services-cta-title">Ready to Protect Your Data?</h2>
                        <p className="services-cta-subtitle">
                            Start using Data Guardian today. No registration required.
                        </p>
                        <div className="services-cta-buttons">
                            <Link href="/signup" className="btn btn-primary btn-large">
                                <span>Create Secure Link</span>
                                <svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor">
                                    <path fillRule="evenodd" d="M10.293 3.293a1 1 0 011.414 0l6 6a1 1 0 010 1.414l-6 6a1 1 0 01-1.414-1.414L14.586 11H3a1 1 0 110-2h11.586l-4.293-4.293a1 1 0 010-1.414z" clipRule="evenodd" />
                                </svg>
                            </Link>
                            <Link href="/how-it-works" className="btn btn-secondary btn-large">
                                <span>Learn More</span>
                            </Link>
                        </div>
                    </div>
                </div>
            </section>
        </main>
    );
}
