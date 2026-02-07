import Link from 'next/link';

export default function HowItWorksPage() {
    return (
        <main className="how-it-works-page">
            {/* Hero Section */}
            <section className="how-hero-section">
                <div className="container">
                    <div className="how-hero-content">
                        <h1 className="how-hero-title">
                            How <span className="gradient-text">Data Guardian</span> Works
                        </h1>
                        <p className="how-hero-subtitle">
                            Secure data sharing in three simple steps. No technical expertise required.
                        </p>
                    </div>
                </div>
            </section>

            {/* Steps Section */}
            <section className="steps-section">
                <div className="container">
                    <div className="steps-timeline">
                        {/* Step 1 */}
                        <div className="step-item">
                            <div className="step-number-wrapper">
                                <div className="step-line"></div>
                                <div className="step-number">1</div>
                            </div>
                            <div className="step-content">
                                <div className="step-icon step-icon-blue">
                                    <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
                                        <polyline points="14 2 14 8 20 8"></polyline>
                                        <line x1="16" y1="13" x2="8" y2="13"></line>
                                        <line x1="16" y1="17" x2="8" y2="17"></line>
                                        <polyline points="10 9 9 9 8 9"></polyline>
                                    </svg>
                                </div>
                                <h3 className="step-title">Enter Your Information</h3>
                                <p className="step-description">
                                    Fill in the recipient's details and upload any files you want to share securely.
                                    You can attach documents, images, spreadsheets, or any file up to 15MB.
                                </p>
                                <div className="step-features">
                                    <div className="step-feature">
                                        <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
                                            <path d="M10.97 4.97a.75.75 0 0 1 1.07 1.05l-3.99 4.99a.75.75 0 0 1-1.08.02L4.324 8.384a.75.75 0 1 1 1.06-1.06l2.094 2.093 3.473-4.425a.267.267 0 0 1 .02-.022z" />
                                        </svg>
                                        <span>Personal details (name, email, phone)</span>
                                    </div>
                                    <div className="step-feature">
                                        <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
                                            <path d="M10.97 4.97a.75.75 0 0 1 1.07 1.05l-3.99 4.99a.75.75 0 0 1-1.08.02L4.324 8.384a.75.75 0 1 1 1.06-1.06l2.094 2.093 3.473-4.425a.267.267 0 0 1 .02-.022z" />
                                        </svg>
                                        <span>Optional file attachments</span>
                                    </div>
                                    <div className="step-feature">
                                        <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
                                            <path d="M10.97 4.97a.75.75 0 0 1 1.07 1.05l-3.99 4.99a.75.75 0 0 1-1.08.02L4.324 8.384a.75.75 0 1 1 1.06-1.06l2.094 2.093 3.473-4.425a.267.267 0 0 1 .02-.022z" />
                                        </svg>
                                        <span>Set custom expiration time</span>
                                    </div>
                                </div>
                            </div>
                        </div>

                        {/* Step 2 */}
                        <div className="step-item">
                            <div className="step-number-wrapper">
                                <div className="step-line"></div>
                                <div className="step-number">2</div>
                            </div>
                            <div className="step-content">
                                <div className="step-icon step-icon-cyan">
                                    <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                        <rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect>
                                        <path d="M7 11V7a5 5 0 0 1 10 0v4"></path>
                                    </svg>
                                </div>
                                <h3 className="step-title">Get Your Secure Link & OTP</h3>
                                <p className="step-description">
                                    Instantly receive an encrypted link and a one-time password (OTP). The system also generates
                                    a QR code for easy mobile sharing and an owner dashboard link for access control.
                                </p>
                                <div className="step-features">
                                    <div className="step-feature">
                                        <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
                                            <path d="M10.97 4.97a.75.75 0 0 1 1.07 1.05l-3.99 4.99a.75.75 0 0 1-1.08.02L4.324 8.384a.75.75 0 1 1 1.06-1.06l2.094 2.093 3.473-4.425a.267.267 0 0 1 .02-.022z" />
                                        </svg>
                                        <span>Encrypted secure link</span>
                                    </div>
                                    <div className="step-feature">
                                        <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
                                            <path d="M10.97 4.97a.75.75 0 0 1 1.07 1.05l-3.99 4.99a.75.75 0 0 1-1.08.02L4.324 8.384a.75.75 0 1 1 1.06-1.06l2.094 2.093 3.473-4.425a.267.267 0 0 1 .02-.022z" />
                                        </svg>
                                        <span>6-digit OTP for authentication</span>
                                    </div>
                                    <div className="step-feature">
                                        <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
                                            <path d="M10.97 4.97a.75.75 0 0 1 1.07 1.05l-3.99 4.99a.75.75 0 0 1-1.08.02L4.324 8.384a.75.75 0 1 1 1.06-1.06l2.094 2.093 3.473-4.425a.267.267 0 0 1 .02-.022z" />
                                        </svg>
                                        <span>QR code for mobile access</span>
                                    </div>
                                    <div className="step-feature">
                                        <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
                                            <path d="M10.97 4.97a.75.75 0 0 1 1.07 1.05l-3.99 4.99a.75.75 0 0 1-1.08.02L4.324 8.384a.75.75 0 1 1 1.06-1.06l2.094 2.093 3.473-4.425a.267.267 0 0 1 .02-.022z" />
                                        </svg>
                                        <span>Owner dashboard (kill switch)</span>
                                    </div>
                                </div>
                            </div>
                        </div>

                        {/* Step 3 */}
                        <div className="step-item">
                            <div className="step-number-wrapper">
                                <div className="step-line"></div>
                                <div className="step-number">3</div>
                            </div>
                            <div className="step-content">
                                <div className="step-icon step-icon-purple">
                                    <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                        <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"></path>
                                        <polyline points="22,6 12,13 2,6"></polyline>
                                    </svg>
                                </div>
                                <h3 className="step-title">Share Securely</h3>
                                <p className="step-description">
                                    Send the secure link to your recipient through any channel (email, messaging app, etc.).
                                    Share the OTP separately for maximum security. The recipient enters the OTP to access the data.
                                </p>
                                <div className="step-features">
                                    <div className="step-feature">
                                        <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
                                            <path d="M10.97 4.97a.75.75 0 0 1 1.07 1.05l-3.99 4.99a.75.75 0 0 1-1.08.02L4.324 8.384a.75.75 0 1 1 1.06-1.06l2.094 2.093 3.473-4.425a.267.267 0 0 1 .02-.022z" />
                                        </svg>
                                        <span>Share link via any channel</span>
                                    </div>
                                    <div className="step-feature">
                                        <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
                                            <path d="M10.97 4.97a.75.75 0 0 1 1.07 1.05l-3.99 4.99a.75.75 0 0 1-1.08.02L4.324 8.384a.75.75 0 1 1 1.06-1.06l2.094 2.093 3.473-4.425a.267.267 0 0 1 .02-.022z" />
                                        </svg>
                                        <span>Send OTP separately</span>
                                    </div>
                                    <div className="step-feature">
                                        <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
                                            <path d="M10.97 4.97a.75.75 0 0 1 1.07 1.05l-3.99 4.99a.75.75 0 0 1-1.08.02L4.324 8.384a.75.75 0 1 1 1.06-1.06l2.094 2.093 3.473-4.425a.267.267 0 0 1 .02-.022z" />
                                        </svg>
                                        <span>Auto-expires after set time</span>
                                    </div>
                                    <div className="step-feature">
                                        <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
                                            <path d="M10.97 4.97a.75.75 0 0 1 1.07 1.05l-3.99 4.99a.75.75 0 0 1-1.08.02L4.324 8.384a.75.75 0 1 1 1.06-1.06l2.094 2.093 3.473-4.425a.267.267 0 0 1 .02-.022z" />
                                        </svg>
                                        <span>Revoke access anytime</span>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </section>

            {/* Security Features */}
            <section className="security-section">
                <div className="container">
                    <div className="section-header">
                        <h2 className="section-title">Built-In Security Features</h2>
                        <p className="section-subtitle">
                            Multiple layers of protection for your sensitive data
                        </p>
                    </div>

                    <div className="security-grid">
                        <div className="security-card">
                            <div className="security-icon">
                                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                    <rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect>
                                    <path d="M7 11V7a5 5 0 0 1 10 0v4"></path>
                                </svg>
                            </div>
                            <h4 className="security-title">AES-256 Encryption</h4>
                            <p className="security-description">
                                Military-grade encryption protects your data both in transit and at rest.
                            </p>
                        </div>

                        <div className="security-card">
                            <div className="security-icon">
                                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                    <circle cx="12" cy="12" r="10"></circle>
                                    <polyline points="12 6 12 12 16 14"></polyline>
                                </svg>
                            </div>
                            <h4 className="security-title">Time-Based Expiration</h4>
                            <p className="security-description">
                                Links automatically self-destruct after your specified time period.
                            </p>
                        </div>

                        <div className="security-card">
                            <div className="security-icon">
                                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                    <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"></path>
                                    <path d="M19 10v2a7 7 0 0 1-14 0v-2"></path>
                                    <line x1="12" y1="19" x2="12" y2="23"></line>
                                    <line x1="8" y1="23" x2="16" y2="23"></line>
                                </svg>
                            </div>
                            <h4 className="security-title">OTP Authentication</h4>
                            <p className="security-description">
                                Two-factor authentication with one-time passwords for extra security.
                            </p>
                        </div>

                        <div className="security-card">
                            <div className="security-icon">
                                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                    <polyline points="1 4 1 10 7 10"></polyline>
                                    <polyline points="23 20 23 14 17 14"></polyline>
                                    <path d="M20.49 9A9 9 0 0 0 5.64 5.64L1 10m22 4l-4.64 4.36A9 9 0 0 1 3.51 15"></path>
                                </svg>
                            </div>
                            <h4 className="security-title">Instant Revocation</h4>
                            <p className="security-description">
                                Kill switch lets you revoke access immediately, even before expiration.
                            </p>
                        </div>

                        <div className="security-card">
                            <div className="security-icon">
                                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path>
                                    <circle cx="12" cy="12" r="3"></circle>
                                    <line x1="1" y1="1" x2="23" y2="23"></line>
                                </svg>
                            </div>
                            <h4 className="security-title">Zero Knowledge</h4>
                            <p className="security-description">
                                We never store your unencrypted data. Complete privacy guaranteed.
                            </p>
                        </div>

                        <div className="security-card">
                            <div className="security-icon">
                                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                    <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"></path>
                                    <path d="M9 12l2 2 4-4"></path>
                                </svg>
                            </div>
                            <h4 className="security-title">Secure by Default</h4>
                            <p className="security-description">
                                All security features are enabled automatically. No configuration needed.
                            </p>
                        </div>
                    </div>
                </div>
            </section>

            {/* Use Cases */}
            <section className="use-cases-section">
                <div className="container">
                    <div className="section-header">
                        <h2 className="section-title">Perfect For</h2>
                        <p className="section-subtitle">
                            Secure sharing for every scenario
                        </p>
                    </div>

                    <div className="use-cases-grid">
                        <div className="use-case-card">
                            <div className="use-case-emoji">💼</div>
                            <h4 className="use-case-title">Business Documents</h4>
                            <p className="use-case-description">
                                Share contracts, NDAs, financial reports, and confidential business information securely.
                            </p>
                        </div>

                        <div className="use-case-card">
                            <div className="use-case-emoji">🏥</div>
                            <h4 className="use-case-title">Medical Records</h4>
                            <p className="use-case-description">
                                HIPAA-compliant sharing of patient records, test results, and sensitive health information.
                            </p>
                        </div>

                        <div className="use-case-card">
                            <div className="use-case-emoji">⚖️</div>
                            <h4 className="use-case-title">Legal Documents</h4>
                            <p className="use-case-description">
                                Securely share case files, evidence, client information, and legal correspondence.
                            </p>
                        </div>

                        <div className="use-case-card">
                            <div className="use-case-emoji">🎓</div>
                            <h4 className="use-case-title">Academic Research</h4>
                            <p className="use-case-description">
                                Share research data, unpublished papers, and confidential academic materials safely.
                            </p>
                        </div>

                        <div className="use-case-card">
                            <div className="use-case-emoji">🏦</div>
                            <h4 className="use-case-title">Financial Data</h4>
                            <p className="use-case-description">
                                Transmit bank statements, tax documents, and sensitive financial information securely.
                            </p>
                        </div>

                        <div className="use-case-card">
                            <div className="use-case-emoji">👤</div>
                            <h4 className="use-case-title">Personal Information</h4>
                            <p className="use-case-description">
                                Share ID documents, passwords, private photos, and personal data with confidence.
                            </p>
                        </div>
                    </div>
                </div>
            </section>

            {/* CTA Section */}
            <section className="how-cta-section">
                <div className="container">
                    <div className="how-cta-card">
                        <h2 className="how-cta-title">Ready to Get Started?</h2>
                        <p className="how-cta-subtitle">
                            Create your first secure link in less than 60 seconds
                        </p>
                        <div className="how-cta-buttons">
                            <Link href="/signup" className="btn btn-primary btn-large">
                                <span>Create Secure Link Now</span>
                                <svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor">
                                    <path fillRule="evenodd" d="M10.293 3.293a1 1 0 011.414 0l6 6a1 1 0 010 1.414l-6 6a1 1 0 01-1.414-1.414L14.586 11H3a1 1 0 110-2h11.586l-4.293-4.293a1 1 0 010-1.414z" clipRule="evenodd" />
                                </svg>
                            </Link>
                            <Link href="/" className="btn btn-secondary btn-large">
                                <svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor">
                                    <path fillRule="evenodd" d="M9.707 16.707a1 1 0 01-1.414 0l-6-6a1 1 0 010-1.414l6-6a1 1 0 011.414 1.414L5.414 9H17a1 1 0 110 2H5.414l4.293 4.293a1 1 0 010 1.414z" clipRule="evenodd" />
                                </svg>
                                <span>Back to Home</span>
                            </Link>
                        </div>
                    </div>
                </div>
            </section>
        </main>
    );
}
