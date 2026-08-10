import Link from 'next/link';
import type { Metadata } from 'next';
import ScrollReveal from '@/components/ScrollReveal';
import { Lock, Zap, Shield } from 'lucide-react';

export const dynamic = 'force-static';

export const metadata: Metadata = {
    title: 'How It Works | Secure Protocol',
    description: 'Learn how Secure Protocol secures your data in three simple steps — military-grade encryption, OTP authentication and instant revocation.',
};

export default function HowItWorksPage() {
    return (
        <main className="hiw-page">

            {/* ── HERO ─────────────────────────────────────────────── */}
            <section className="hiw-hero">
                <div className="container hiw-hero-inner">
                    <div className="hiw-hero-left">
                        <div className="brand-badge badge-center" style={{ display: 'inline-flex', marginBottom: '20px' }}>
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" style={{ marginRight: '6px' }}>
                                <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
                            </svg>
                            <span>HOW IT WORKS</span>
                        </div>
                        <h1 className="hiw-hero-h1">
                            Secure sharing in<br />
                            <span className="gradient-text">three simple steps</span>
                        </h1>
                        <p className="hiw-hero-p">
                            No technical expertise needed. Protect, share and revoke sensitive data with military-grade encryption in under a minute.
                        </p>
                        <div className="hiw-hero-actions">
                            <Link href="/create-link" className="btn btn-primary btn-large">
                                <span>Get Started Free</span>
                                <svg width="18" height="18" viewBox="0 0 20 20" fill="currentColor">
                                    <path fillRule="evenodd" d="M10.293 3.293a1 1 0 011.414 0l6 6a1 1 0 010 1.414l-6 6a1 1 0 01-1.414-1.414L14.586 11H3a1 1 0 110-2h11.586l-4.293-4.293a1 1 0 010-1.414z" clipRule="evenodd" />
                                </svg>
                            </Link>
                            <Link href="/services" className="btn btn-secondary btn-large">
                                <span>View All Features</span>
                            </Link>
                        </div>
                    </div>

                    <div className="hiw-hero-right">
                    </div>
                </div>
            </section>

            {/* ── STAT STRIP ───────────────────────────────────────── */}
            <section className="hiw-stat-strip">
                <div className="container hiw-stat-inner">
                    <div className="hiw-stat-item">
                        <span className="hiw-stat-num gradient-text">256-bit</span>
                        <span className="hiw-stat-label">AES Encryption</span>
                    </div>
                    <div className="hiw-stat-div" />
                    <div className="hiw-stat-item">
                        <span className="hiw-stat-num gradient-text">100%</span>
                        <span className="hiw-stat-label">Zero Knowledge</span>
                    </div>
                    <div className="hiw-stat-div" />
                    <div className="hiw-stat-item">
                        <span className="hiw-stat-num gradient-text">&lt; 60s</span>
                        <span className="hiw-stat-label">Setup Time</span>
                    </div>
                    <div className="hiw-stat-div" />
                    <div className="hiw-stat-item">
                        <span className="hiw-stat-num gradient-text">Instant</span>
                        <span className="hiw-stat-label">Link Revocation</span>
                    </div>
                </div>
            </section>

            {/* ── PROCESS STEPS ────────────────────────────────────── */}
            <section className="hiw-process-section">
                <div className="container">
                    <ScrollReveal>
                        <div className="hiw-section-header">
                            <div className="brand-badge badge-center" style={{ display: 'inline-flex', marginBottom: '16px' }}>
                                <span>THE PROCESS</span>
                            </div>
                            <h2 className="hiw-section-h2">Three steps to complete security</h2>
                            <p className="hiw-section-sub">From setup to sharing in under a minute.</p>
                        </div>
                    </ScrollReveal>

                    {/* Step 1 */}
                    <ScrollReveal delay={1}>
                        <div className="hiw-step-row">
                            <div className="hiw-step-visual hiw-step-visual-blue">
                                <div className="hiw-step-num-big">01</div>
                                <div className="hiw-step-icon-wrap hiw-sicon-blue">
                                    <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                                        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                                        <polyline points="14 2 14 8 20 8" />
                                        <line x1="16" y1="13" x2="8" y2="13" />
                                        <line x1="16" y1="17" x2="8" y2="17" />
                                    </svg>
                                </div>
                                <div className="hiw-step-connector" />
                            </div>
                            <div className="hiw-step-body">
                                <span className="hiw-step-tag">Step 1</span>
                                <h3 className="hiw-step-h3">Enter Your Information</h3>
                                <p className="hiw-step-p">Fill in the recipient's details and the sensitive information you want to share. Attach documents, images, or any file up to 15MB — all encrypted before it ever leaves your device.</p>
                                <ul className="hiw-checklist">
                                    <li><span className="hiw-check hiw-check-blue">✓</span> Add recipient name & email</li>
                                    <li><span className="hiw-check hiw-check-blue">✓</span> Upload files (optional, up to 15MB)</li>
                                    <li><span className="hiw-check hiw-check-blue">✓</span> Set custom expiration time</li>
                                    <li><span className="hiw-check hiw-check-blue">✓</span> Add a private note</li>
                                </ul>
                            </div>
                        </div>
                    </ScrollReveal>

                    {/* Step 2 */}
                    <ScrollReveal delay={2}>
                        <div className="hiw-step-row hiw-step-row-rev">
                            <div className="hiw-step-visual hiw-step-visual-cyan">
                                <div className="hiw-step-num-big">02</div>
                                <div className="hiw-step-icon-wrap hiw-sicon-cyan">
                                    <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                                        <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                                        <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                                    </svg>
                                </div>
                                <div className="hiw-step-connector" />
                            </div>
                            <div className="hiw-step-body">
                                <span className="hiw-step-tag hiw-tag-cyan">Step 2</span>
                                <h3 className="hiw-step-h3">Get Your Secure Link & OTP</h3>
                                <p className="hiw-step-p">Instantly receive a unique encrypted link, a 6-digit one-time password and a QR code. An owner dashboard link gives you complete access control from any device.</p>
                                <ul className="hiw-checklist">
                                    <li><span className="hiw-check hiw-check-cyan">✓</span> Encrypted, time-limited link</li>
                                    <li><span className="hiw-check hiw-check-cyan">✓</span> 6-digit OTP (separate channel)</li>
                                    <li><span className="hiw-check hiw-check-cyan">✓</span> QR code for mobile access</li>
                                    <li><span className="hiw-check hiw-check-cyan">✓</span> Owner dashboard for full control</li>
                                </ul>
                            </div>
                        </div>
                    </ScrollReveal>

                    {/* Step 3 */}
                    <ScrollReveal delay={3}>
                        <div className="hiw-step-row">
                            <div className="hiw-step-visual hiw-step-visual-purple">
                                <div className="hiw-step-num-big">03</div>
                                <div className="hiw-step-icon-wrap hiw-sicon-purple">
                                    <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                                        <line x1="22" y1="2" x2="11" y2="13" />
                                        <polygon points="22 2 15 22 11 13 2 9 22 2" />
                                    </svg>
                                </div>
                            </div>
                            <div className="hiw-step-body">
                                <span className="hiw-step-tag hiw-tag-purple">Step 3</span>
                                <h3 className="hiw-step-h3">Share & Stay in Control</h3>
                                <p className="hiw-step-p">Send the secure link through any channel and share the OTP separately. The recipient enters both to unlock — and you can revoke access at any moment, even before the link expires.</p>
                                <ul className="hiw-checklist">
                                    <li><span className="hiw-check hiw-check-purple">✓</span> Share via email, SMS, WhatsApp or any app</li>
                                    <li><span className="hiw-check hiw-check-purple">✓</span> Send OTP through a different channel</li>
                                    <li><span className="hiw-check hiw-check-purple">✓</span> Auto-expires after set duration</li>
                                    <li><span className="hiw-check hiw-check-purple">✓</span> One-click revocation anytime</li>
                                </ul>
                            </div>
                        </div>
                    </ScrollReveal>
                </div>
            </section>

            {/* ── SECURITY FEATURES GRID ───────────────────────────── */}
            <section className="hiw-security-section">
                <div className="container">
                    <ScrollReveal>
                        <div className="hiw-section-header">
                            <div className="brand-badge badge-center" style={{ display: 'inline-flex', marginBottom: '16px' }}>
                                <span>BUILT-IN SECURITY</span>
                            </div>
                            <h2 className="hiw-section-h2">Every layer protected</h2>
                            <p className="hiw-section-sub">Six layers of enterprise-grade security — activated automatically, no configuration required.</p>
                        </div>
                    </ScrollReveal>

                    <div className="hiw-sec-grid">
                        {[
                            {
                                delay: 1, color: 'blue', label: 'AES-256 Encryption',
                                desc: 'Military-grade encryption protects your data in transit and at rest.',
                                icon: <><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" /><path d="M12 8v4" /><path d="M12 16h.01" /></>,
                            },
                            {
                                delay: 2, color: 'green', label: 'Time-Based Expiration',
                                desc: 'Links automatically self-destruct when your set duration expires.',
                                icon: <><circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" /></>,
                            },
                            {
                                delay: 3, color: 'purple', label: 'OTP Authentication',
                                desc: 'Two-factor protection — only the right person with the right code can open it.',
                                icon: <><rect x="3" y="11" width="18" height="11" rx="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" /></>,
                            },
                            {
                                delay: 4, color: 'orange', label: 'Instant Revocation',
                                desc: 'Kill-switch lets you block access immediately, even before expiry.',
                                icon: <><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" /><path d="M3 3v5h5" /></>,
                            },
                            {
                                delay: 5, color: 'pink', label: 'Zero Knowledge',
                                desc: "We never see your unencrypted data. Ever. Complete privacy guaranteed.",
                                icon: <><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" /><line x1="1" y1="1" x2="23" y2="23" /></>,
                            },
                            {
                                delay: 6, color: 'cyan', label: 'Secure by Default',
                                desc: 'All protections are on from the start. No setup or configuration needed.',
                                icon: <><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" /><polyline points="9 12 11 14 15 10" /></>,
                            },
                        ].map(({ delay, color, label, desc, icon }) => (
                            <ScrollReveal key={label} delay={delay}>
                                <div className={`hiw-sec-card hiw-sec-card-${color}`}>
                                    <div className={`hiw-sec-icon hiw-si-${color}`}>
                                        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">{icon}</svg>
                                    </div>
                                    <h3 className="hiw-sec-title">{label}</h3>
                                    <p className="hiw-sec-desc">{desc}</p>
                                </div>
                            </ScrollReveal>
                        ))}
                    </div>
                </div>
            </section>

            {/* ── USE CASES ────────────────────────────────────────── */}
            <section className="hiw-usecases-section">
                <div className="container">
                    <ScrollReveal>
                        <div className="hiw-section-header">
                            <div className="brand-badge badge-center" style={{ display: 'inline-flex', marginBottom: '16px' }}>
                                <span>PERFECT FOR</span>
                            </div>
                            <h2 className="hiw-section-h2">Works for every industry</h2>
                            <p className="hiw-section-sub">Trusted for secure sharing across healthcare, legal, finance and more.</p>
                        </div>
                    </ScrollReveal>

                    <div className="hiw-uc-grid">
                        {[
                            { delay: 1, color: 'blue', label: 'Business Documents', desc: 'Contracts, proposals, financial reports and confidential business data.', icon: <><rect x="2" y="7" width="20" height="14" rx="2" /><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16" /></> },
                            { delay: 2, color: 'pink', label: 'Medical Records', desc: 'Patient records, test results and sensitive health information.', icon: <><path d="M20.42 4.58a5.4 5.4 0 0 0-7.65 0l-.77.78-.77-.78a5.4 5.4 0 0 0-7.65 0C1.46 6.7 1.33 10.28 4 13l8 8 8-8c2.67-2.72 2.54-6.3.42-8.42z" /><line x1="12" y1="8" x2="12" y2="14" /><line x1="9" y1="11" x2="15" y2="11" /></> },
                            { delay: 3, color: 'purple', label: 'Legal Documents', desc: 'Case files, evidence, client information and legal correspondence.', icon: <><circle cx="12" cy="12" r="10" /><line x1="2" y1="12" x2="22" y2="12" /><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" /></> },
                            { delay: 4, color: 'green', label: 'Financial Data', desc: 'Bank statements, tax documents and financial records shared safely.', icon: <><polyline points="22 12 18 12 15 21 9 3 6 12 2 12" /></> },
                            { delay: 5, color: 'orange', label: 'Academic Research', desc: 'Research papers, datasets and confidential academic materials.', icon: <><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" /><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" /></> },
                            { delay: 6, color: 'cyan', label: 'Personal Information', desc: 'ID documents, passwords, photos and personal data shared with confidence.', icon: <><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" /></> },
                        ].map(({ delay, color, label, desc, icon }) => (
                            <ScrollReveal key={label} delay={delay}>
                                <div className="hiw-uc-card">
                                    <div className={`hiw-uc-icon hiw-ui-${color}`}>
                                        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">{icon}</svg>
                                    </div>
                                    <h3 className="hiw-uc-title">{label}</h3>
                                    <p className="hiw-uc-desc">{desc}</p>
                                </div>
                            </ScrollReveal>
                        ))}
                    </div>
                </div>
            </section>

            {/* ── CTA ──────────────────────────────────────────────── */}
            <section className="hiw-cta-outer">
                <div className="container">
                    <ScrollReveal>
                        <div className="hiw-cta-box">
                            <div className="hiw-cta-left">
                                <div className="brand-badge badge-center" style={{ display: 'inline-flex', marginBottom: '20px' }}>
                                    <span>GET STARTED TODAY</span>
                                </div>
                                <h2 className="hiw-cta-h2">Ready to share data securely?</h2>
                                <p className="hiw-cta-p">Start in seconds. No credit card. No registration. Just protected sharing.</p>
                                <div className="hiw-cta-btns">
                                    <Link href="/create-link" className="btn btn-primary btn-large">
                                        <span>Create Secure Link</span>
                                        <svg width="18" height="18" viewBox="0 0 20 20" fill="currentColor">
                                            <path fillRule="evenodd" d="M10.293 3.293a1 1 0 011.414 0l6 6a1 1 0 010 1.414l-6 6a1 1 0 01-1.414-1.414L14.586 11H3a1 1 0 110-2h11.586l-4.293-4.293a1 1 0 010-1.414z" clipRule="evenodd" />
                                        </svg>
                                    </Link>
                                    <Link href="/services" className="btn btn-secondary btn-large">
                                        <span>Explore Services</span>
                                    </Link>
                                </div>
                                {/* Mini trust row */}
                                <div className="hiw-cta-trust">
                                     <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                                         <Lock size={14} /> End-to-end encrypted
                                     </span>
                                     <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                                         <Zap size={14} /> Instant setup
                                     </span>
                                     <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                                         <Shield size={14} /> ISO 27001 standards
                                     </span>
                                </div>
                            </div>
                        </div>
                    </ScrollReveal>
                </div>
            </section>

        </main>
    );
}
