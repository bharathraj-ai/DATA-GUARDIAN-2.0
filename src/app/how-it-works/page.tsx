import Link from 'next/link';
import type { Metadata } from 'next';
import ScrollReveal from '@/components/ScrollReveal';

export const metadata: Metadata = {
    title: 'How It Works | Secure Protocol',
    description: 'Learn how Secure Protocol secures your data in three simple steps.',
};

export default function HowItWorksPage() {
    return (
        <main className="how-it-works-page">
            {/* Hero / Steps Section */}
            <section className="hiw-steps-section">
                <div className="container">
                    <div className="hiw-text-center">
                        <div className="brand-badge badge-center">
                            <span>HOW IT WORKS</span>
                        </div>
                        <h1 className="hiw-hero-title">
                            How <span className="gradient-text">Secure Protocol</span> Works
                        </h1>
                        <p className="hiw-hero-subtitle">
                            Secure data sharing in three simple steps. No technical expertise required.
                        </p>
                    </div>

                    <div className="hiw-steps-container">
                        <div className="hiw-steps-timeline-line"></div>
                        <div className="hiw-steps-grid">
                            
                            {/* Step 1 */}
                            <ScrollReveal delay={1}>
                                <div className="hiw-step-card">
                                    <div className="hiw-step-number">1</div>
                                    <div className="hiw-step-icon hiw-step-icon-blue">
                                        <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
                                            <polyline points="14 2 14 8 20 8"></polyline>
                                            <line x1="16" y1="13" x2="8" y2="13"></line>
                                            <line x1="16" y1="17" x2="8" y2="17"></line>
                                            <polyline points="10 9 9 9 8 9"></polyline>
                                        </svg>
                                        <div className="hiw-icon-badge">↑</div>
                                    </div>
                                    <h3 className="hiw-step-title">Enter Your Information</h3>
                                    <p className="hiw-step-desc">
                                        Fill in the recipient's details and the information you want to share. You can attach documents, images, or any file up to 15MB.
                                    </p>
                                    <ul className="hiw-step-list">
                                        <li>
                                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="20 6 9 17 4 12"></polyline></svg>
                                            Add recipient details
                                        </li>
                                        <li>
                                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="20 6 9 17 4 12"></polyline></svg>
                                            Upload files (optional)
                                        </li>
                                        <li>
                                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="20 6 9 17 4 12"></polyline></svg>
                                            Set custom expiration time
                                        </li>
                                    </ul>
                                </div>
                            </ScrollReveal>

                            {/* Step 2 */}
                            <ScrollReveal delay={2}>
                                <div className="hiw-step-card">
                                    <div className="hiw-step-number">2</div>
                                    <div className="hiw-step-icon hiw-step-icon-cyan">
                                        <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                            <rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect>
                                            <path d="M7 11V7a5 5 0 0 1 10 0v4"></path>
                                        </svg>
                                        <div className="hiw-icon-badge hiw-badge-green">✓</div>
                                    </div>
                                    <h3 className="hiw-step-title">Get Your Secure Link & OTP</h3>
                                    <p className="hiw-step-desc">
                                        Instantly receive a secure, encrypted link and a one-time password (OTP). The system also generates a QR code for easy mobile sharing and an owner dashboard link for access control.
                                    </p>
                                    <ul className="hiw-step-list">
                                        <li>
                                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="20 6 9 17 4 12"></polyline></svg>
                                            Encrypted secure link
                                        </li>
                                        <li>
                                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="20 6 9 17 4 12"></polyline></svg>
                                            6-digit OTP for authentication
                                        </li>
                                        <li>
                                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="20 6 9 17 4 12"></polyline></svg>
                                            QR code for mobile access
                                        </li>
                                        <li>
                                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="20 6 9 17 4 12"></polyline></svg>
                                            Owner dashboard (full control)
                                        </li>
                                    </ul>
                                </div>
                            </ScrollReveal>

                            {/* Step 3 */}
                            <ScrollReveal delay={3}>
                                <div className="hiw-step-card">
                                    <div className="hiw-step-number">3</div>
                                    <div className="hiw-step-icon hiw-step-icon-purple">
                                        <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                            <line x1="22" y1="2" x2="11" y2="13"></line>
                                            <polygon points="22 2 15 22 11 13 2 9 22 2"></polygon>
                                        </svg>
                                    </div>
                                    <h3 className="hiw-step-title">Share Securely</h3>
                                    <p className="hiw-step-desc">
                                        Send the secure link and OTP through your preferred channel. The recipient uses both to access the data securely.
                                    </p>
                                    <ul className="hiw-step-list">
                                        <li>
                                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="20 6 9 17 4 12"></polyline></svg>
                                            Share link via any channel
                                        </li>
                                        <li>
                                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="20 6 9 17 4 12"></polyline></svg>
                                            Send OTP separately
                                        </li>
                                        <li>
                                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="20 6 9 17 4 12"></polyline></svg>
                                            Auto-expires after set time
                                        </li>
                                        <li>
                                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="20 6 9 17 4 12"></polyline></svg>
                                            Revoke access anytime
                                        </li>
                                    </ul>
                                </div>
                            </ScrollReveal>
                        </div>
                    </div>
                </div>
            </section>

            {/* Security Features */}
            <section className="features-section hiw-features-section bg-tertiary">
                <div className="container">
                    <div className="hiw-text-center">
                        <div className="brand-badge badge-center">
                            <span>BUILT-IN SECURITY</span>
                        </div>
                        <h2 className="hiw-section-title">Built-In Security Features</h2>
                        <p className="hiw-section-subtitle">
                            Multiple layers of protection for your sensitive data.
                        </p>
                    </div>

                    <div className="features-grid hiw-features-grid">
                        <ScrollReveal delay={1}>
                            <div className="feature-card hiw-feature-card">
                                <div className="feature-icon feature-icon-blue">
                                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                        <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"></path>
                                        <path d="M12 8v4"></path>
                                        <path d="M12 16h.01"></path>
                                    </svg>
                                </div>
                                <h3 className="feature-title">AES-256 Encryption</h3>
                                <p className="feature-description">
                                    Military-grade encryption protects your data both in transit and at rest.
                                </p>
                            </div>
                        </ScrollReveal>
                        <ScrollReveal delay={2}>
                            <div className="feature-card hiw-feature-card">
                                <div className="feature-icon feature-icon-cyan">
                                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                        <circle cx="12" cy="12" r="10"></circle>
                                        <polyline points="12 6 12 12 16 14"></polyline>
                                    </svg>
                                </div>
                                <h3 className="feature-title">Time-Based Expiration</h3>
                                <p className="feature-description">
                                    Links automatically self-destruct after your specified time period.
                                </p>
                            </div>
                        </ScrollReveal>
                        <ScrollReveal delay={3}>
                            <div className="feature-card hiw-feature-card">
                                <div className="feature-icon feature-icon-purple">
                                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                        <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"></path>
                                    </svg>
                                </div>
                                <h3 className="feature-title">OTP Authentication</h3>
                                <p className="feature-description">
                                    Two-factor authentication with one-time passwords for extra security.
                                </p>
                            </div>
                        </ScrollReveal>
                        <ScrollReveal delay={4}>
                            <div className="feature-card hiw-feature-card">
                                <div className="feature-icon feature-icon-green">
                                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                        <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"></path>
                                        <path d="M3 3v5h5"></path>
                                    </svg>
                                </div>
                                <h3 className="feature-title">Instant Revocation</h3>
                                <p className="feature-description">
                                    Kill switch feature lets you revoke access immediately, even before expiration.
                                </p>
                            </div>
                        </ScrollReveal>
                        <ScrollReveal delay={5}>
                            <div className="feature-card hiw-feature-card">
                                <div className="feature-icon feature-icon-pink">
                                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                        <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"></path>
                                        <line x1="1" y1="1" x2="23" y2="23"></line>
                                    </svg>
                                </div>
                                <h3 className="feature-title">Zero Knowledge</h3>
                                <p className="feature-description">
                                    We never store your unencrypted data. Complete privacy guaranteed.
                                </p>
                            </div>
                        </ScrollReveal>
                        <ScrollReveal delay={6}>
                            <div className="feature-card hiw-feature-card">
                                <div className="feature-icon feature-icon-orange">
                                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                        <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"></path>
                                        <polyline points="9 12 11 14 15 10"></polyline>
                                    </svg>
                                </div>
                                <h3 className="feature-title">Secure by Default</h3>
                                <p className="feature-description">
                                    All security features are enabled automatically. No configuration needed.
                                </p>
                            </div>
                        </ScrollReveal>
                    </div>
                </div>
            </section>

            {/* Scenarios Section */}
            <section className="hiw-scenarios-section">
                <div className="container">
                    <div className="hiw-text-center">
                        <div className="brand-badge badge-center">
                            <span>PERFECT FOR</span>
                        </div>
                        <h2 className="hiw-section-title">Perfect For Every Scenario</h2>
                        <p className="hiw-section-subtitle">
                            Secure sharing for all your important data.
                        </p>
                    </div>

                    <div className="hiw-scenario-grid">
                        <div className="feature-card hiw-scenario-card">
                            <div className="feature-icon feature-icon-blue">
                                <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                                    <rect x="2" y="7" width="20" height="14" rx="2" ry="2"></rect>
                                    <path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"></path>
                                </svg>
                            </div>
                            <h3 className="feature-title">Business Documents</h3>
                            <p className="feature-description">Contracts, proposals, financial reports, and confidential business information.</p>
                        </div>

                        <div className="feature-card hiw-scenario-card">
                            <div className="feature-icon feature-icon-blue">
                                <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                                    <path d="M20.42 4.58a5.4 5.4 0 0 0-7.65 0l-.77.78-.77-.78a5.4 5.4 0 0 0-7.65 0C1.46 6.7 1.33 10.28 4 13l8 8 8-8c2.67-2.72 2.54-6.3.42-8.42z"></path>
                                    <line x1="12" y1="8" x2="12" y2="14"></line>
                                    <line x1="9" y1="11" x2="15" y2="11"></line>
                                </svg>
                            </div>
                            <h3 className="feature-title">Medical Records</h3>
                            <p className="feature-description">Patient records, test results, and sensitive health information.</p>
                        </div>

                        <div className="feature-card hiw-scenario-card">
                            <div className="feature-icon feature-icon-blue">
                                <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                                    <circle cx="12" cy="12" r="10"></circle>
                                    <line x1="2" y1="12" x2="22" y2="12"></line>
                                    <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"></path>
                                </svg>
                            </div>
                            <h3 className="feature-title">Legal Documents</h3>
                            <p className="feature-description">Case files, evidence, client information, and legal correspondence.</p>
                        </div>

                        <div className="feature-card hiw-scenario-card">
                            <div className="feature-icon feature-icon-blue">
                                <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                                    <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"></path>
                                    <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"></path>
                                </svg>
                            </div>
                            <h3 className="feature-title">Academic Research</h3>
                            <p className="feature-description">Research papers, data sets, and confidential academic materials.</p>
                        </div>

                        <div className="feature-card hiw-scenario-card">
                            <div className="feature-icon feature-icon-blue">
                                <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                                    <polyline points="22 12 18 12 15 21 9 3 6 12 2 12"></polyline>
                                </svg>
                            </div>
                            <h3 className="feature-title">Financial Data</h3>
                            <p className="feature-description">Bank statements, tax documents, and financial information securely.</p>
                        </div>

                        <div className="feature-card hiw-scenario-card">
                            <div className="feature-icon feature-icon-blue">
                                <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                                    <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path>
                                    <circle cx="12" cy="7" r="4"></circle>
                                </svg>
                            </div>
                            <h3 className="feature-title">Personal Information</h3>
                            <p className="feature-description">ID documents, passwords, photos, and personal data with confidence.</p>
                        </div>
                    </div>
                </div>
            </section>


        </main>
    );
}

