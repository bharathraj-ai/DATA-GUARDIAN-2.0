import Link from 'next/link';
import type { Metadata } from 'next';
import ScrollReveal from '@/components/ScrollReveal';
import {
    Lock,
    Zap,
    Shield,
    FileText,
    KeyRound,
    Share2,
    EyeOff,
    Ban,
    CheckCircle2,
    ArrowRight,
    ShieldCheck,
    Timer,
    User,
    Building2,
} from 'lucide-react';

export const dynamic = 'force-static';

export const metadata: Metadata = {
    title: 'How It Works | Secure Protocol',
    description:
        'Learn how Secure Protocol secures your data in three simple steps — military-grade encryption, OTP authentication and instant revocation.',
};

const STEPS = [
    {
        num: '01',
        tag: 'Create',
        title: 'Enter your information',
        desc: 'Add recipient details and the files you need to share. Everything is encrypted before it leaves your device.',
        icon: FileText,
        tone: 'blue',
        items: [
            'Recipient name & email',
            'Upload files (up to 15MB)',
            'Custom expiration window',
            'Optional private note',
        ],
    },
    {
        num: '02',
        tag: 'Protect',
        title: 'Get a secure link & OTP',
        desc: 'A unique encrypted link, 6-digit OTP, and QR code are generated instantly — plus an owner dashboard for control.',
        icon: KeyRound,
        tone: 'cyan',
        items: [
            'Time-limited encrypted link',
            '6-digit OTP on a separate channel',
            'QR code for mobile access',
            'Owner dashboard for full control',
        ],
    },
    {
        num: '03',
        tag: 'Share',
        title: 'Share and stay in control',
        desc: 'Send the link through any channel and the OTP separately. Revoke access instantly, even before expiry.',
        icon: Share2,
        tone: 'purple',
        items: [
            'Email, SMS, WhatsApp, or any app',
            'OTP on a different channel',
            'Auto-expires after the set duration',
            'One-click revocation anytime',
        ],
    },
] as const;

const SECURITY = [
    {
        color: 'blue',
        label: 'AES-256 Encryption',
        desc: 'Military-grade encryption protects data in transit and at rest — no extra setup.',
        icon: Shield,
    },
    {
        color: 'green',
        label: 'Time-based expiration',
        desc: 'Links self-destruct when the window you set expires. Nothing lingers.',
        icon: Timer,
    },
    {
        color: 'purple',
        label: 'OTP authentication',
        desc: 'Two-factor unlock — only the intended person with the code can open it.',
        icon: KeyRound,
    },
    {
        color: 'orange',
        label: 'Instant revocation',
        desc: 'A kill-switch blocks access immediately, even before the link expires.',
        icon: Ban,
    },
    {
        color: 'pink',
        label: 'Zero knowledge',
        desc: 'We never see your unencrypted data. Complete privacy, by design.',
        icon: EyeOff,
    },
    {
        color: 'cyan',
        label: 'Secure by default',
        desc: 'Every protection is on from the start. No configuration required.',
        icon: ShieldCheck,
    },
] as const;

const INDUSTRIES = [
    { color: 'blue', label: 'Business documents', desc: 'Contracts, proposals, and confidential reports.' },
    { color: 'pink', label: 'Medical records', desc: 'Patient files, results, and health data.' },
    { color: 'purple', label: 'Legal documents', desc: 'Case files, evidence, and client correspondence.' },
    { color: 'green', label: 'Financial data', desc: 'Statements, tax files, and financial records.' },
    { color: 'orange', label: 'Academic research', desc: 'Papers, datasets, and unpublished materials.' },
    { color: 'cyan', label: 'Personal information', desc: 'IDs, credentials, photos, and private files.' },
] as const;

export default function HowItWorksPage() {
    return (
        <main className="hiw-page">
            <section className="hiw-hero">
                <div className="container hiw-hero-inner">
                    <div className="hiw-hero-left">
                        <div className="brand-badge" style={{ display: 'inline-flex', marginBottom: 20 }}>
                            <Shield size={14} strokeWidth={2.5} style={{ marginRight: 6 }} />
                            <span>HOW IT WORKS</span>
                        </div>
                        <h1 className="hiw-hero-h1">
                            Secure sharing in
                            <br />
                            <span className="gradient-text">three simple steps</span>
                        </h1>
                        <p className="hiw-hero-p">
                            Protect, share, and revoke sensitive data with AES-256 encryption and OTP access —
                            no technical expertise required. Live in under a minute.
                        </p>
                        <div className="hiw-hero-actions">
                            <Link href="/create-link" className="btn btn-primary btn-large">
                                <span>Get Started Free</span>
                                <ArrowRight size={18} />
                            </Link>
                            <Link href="/services" className="btn btn-secondary btn-large">
                                <span>View All Features</span>
                            </Link>
                        </div>
                        <ul className="hiw-hero-trust">
                            <li>
                                <CheckCircle2 size={16} /> End-to-end encrypted
                            </li>
                            <li>
                                <CheckCircle2 size={16} /> OTP-protected access
                            </li>
                            <li>
                                <CheckCircle2 size={16} /> Instant revocation
                            </li>
                        </ul>
                    </div>

                    <div className="hiw-hero-right" aria-hidden="true">
                        <div className="hiw-proto">
                            <div className="hiw-proto-head">
                                <div>
                                    <span className="hiw-proto-kicker">SECURE PROTOCOL</span>
                                    <strong>Session graph</strong>
                                </div>
                                <span className="hiw-proto-live">
                                    <i /> LIVE
                                </span>
                            </div>

                            <div className="hiw-proto-flow">
                                <div className="hiw-proto-node">
                                    <div className="hiw-proto-icon">
                                        <Building2 size={18} />
                                    </div>
                                    <span>Owner</span>
                                    <small>encrypt &amp; issue</small>
                                </div>
                                <div className="hiw-proto-line">
                                    <span>AES-256-GCM</span>
                                </div>
                                <div className="hiw-proto-node hiw-proto-node-core">
                                    <div className="hiw-proto-icon">
                                        <Shield size={18} />
                                    </div>
                                    <span>Vault</span>
                                    <small>zero-knowledge</small>
                                </div>
                                <div className="hiw-proto-line">
                                    <span>OTP + token</span>
                                </div>
                                <div className="hiw-proto-node">
                                    <div className="hiw-proto-icon">
                                        <User size={18} />
                                    </div>
                                    <span>Vendor</span>
                                    <small>locked session</small>
                                </div>
                            </div>

                            <dl className="hiw-proto-spec">
                                <div>
                                    <dt>cipher</dt>
                                    <dd>AES-256-GCM</dd>
                                </div>
                                <div>
                                    <dt>key wrap</dt>
                                    <dd>KEK / DEK</dd>
                                </div>
                                <div>
                                    <dt>auth</dt>
                                    <dd>OTP · device bind</dd>
                                </div>
                                <div>
                                    <dt>control</dt>
                                    <dd>revoke · ttl</dd>
                                </div>
                            </dl>
                        </div>
                    </div>
                </div>
            </section>

            <section className="hiw-stat-strip">
                <div className="container hiw-stat-inner">
                    <div className="hiw-stat-item">
                        <span className="hiw-stat-num gradient-text">256-bit</span>
                        <span className="hiw-stat-label">AES encryption</span>
                    </div>
                    <div className="hiw-stat-div" />
                    <div className="hiw-stat-item">
                        <span className="hiw-stat-num gradient-text">100%</span>
                        <span className="hiw-stat-label">Zero knowledge</span>
                    </div>
                    <div className="hiw-stat-div" />
                    <div className="hiw-stat-item">
                        <span className="hiw-stat-num gradient-text">&lt; 60s</span>
                        <span className="hiw-stat-label">Time to share</span>
                    </div>
                    <div className="hiw-stat-div" />
                    <div className="hiw-stat-item">
                        <span className="hiw-stat-num gradient-text">Instant</span>
                        <span className="hiw-stat-label">Link revocation</span>
                    </div>
                </div>
            </section>

            <section className="hiw-process-section">
                <div className="container">
                    <ScrollReveal>
                        <div className="hiw-section-header">
                            <div className="brand-badge badge-center" style={{ display: 'inline-flex', marginBottom: 16 }}>
                                <span>THE PROCESS</span>
                            </div>
                            <h2 className="hiw-section-h2">Three steps to complete security</h2>
                            <p className="hiw-section-sub">From setup to sharing in under a minute — with full control after you send.</p>
                        </div>
                    </ScrollReveal>

                    <div className="hiw-step-grid">
                        {STEPS.map((step, i) => {
                            const Icon = step.icon;
                            return (
                                <ScrollReveal key={step.num} delay={i + 1}>
                                    <article className={`hiw-step-card hiw-step-card-${step.tone}`}>
                                        <div className="hiw-step-card-top">
                                            <span className={`hiw-step-num hiw-step-num-${step.tone}`}>{step.num}</span>
                                            <span className={`hiw-step-tag hiw-tag-${step.tone}`}>{step.tag}</span>
                                        </div>
                                        <div className={`hiw-step-icon-wrap hiw-sicon-${step.tone}`}>
                                            <Icon size={28} strokeWidth={1.8} />
                                        </div>
                                        <h3 className="hiw-step-h3">{step.title}</h3>
                                        <p className="hiw-step-p">{step.desc}</p>
                                        <ul className="hiw-checklist">
                                            {step.items.map((item) => (
                                                <li key={item}>
                                                    <span className={`hiw-check hiw-check-${step.tone}`}>✓</span>
                                                    {item}
                                                </li>
                                            ))}
                                        </ul>
                                    </article>
                                </ScrollReveal>
                            );
                        })}
                    </div>
                </div>
            </section>

            <section className="hiw-roles-section">
                <div className="container">
                    <ScrollReveal>
                        <div className="hiw-section-header">
                            <div className="brand-badge badge-center" style={{ display: 'inline-flex', marginBottom: 16 }}>
                                <span>TWO SIDES</span>
                            </div>
                            <h2 className="hiw-section-h2">Built for owners and vendors</h2>
                            <p className="hiw-section-sub">
                                One protocol, two roles — you stay in command while recipients work inside a locked session.
                            </p>
                        </div>
                    </ScrollReveal>

                    <div className="hiw-roles-grid">
                        <ScrollReveal delay={1}>
                            <article className="hiw-role-card">
                                <div className="hiw-role-kicker">For owners</div>
                                <h3>Create, monitor, revoke</h3>
                                <p>Upload encrypted files, issue OTP-protected links, and watch live activity from the dashboard.</p>
                                <ul>
                                    <li>Encrypted upload &amp; link creation</li>
                                    <li>Live session and access history</li>
                                    <li>Kill-switch revocation at any time</li>
                                </ul>
                                <Link href="/create-link" className="hiw-role-link">
                                    Create a secure link <ArrowRight size={16} />
                                </Link>
                            </article>
                        </ScrollReveal>
                        <ScrollReveal delay={2}>
                            <article className="hiw-role-card hiw-role-card-alt">
                                <div className="hiw-role-kicker">For vendors</div>
                                <h3>Verify, work, complete</h3>
                                <p>Open the share link, confirm with OTP, then view or edit inside a protected workspace — no export by default.</p>
                                <ul>
                                    <li>OTP entry on a dedicated share page</li>
                                    <li>Secure viewer and in-browser editor</li>
                                    <li>Break, resume, and complete work</li>
                                </ul>
                                <Link href="/auth/signin" className="hiw-role-link">
                                    Go to vendor sign in <ArrowRight size={16} />
                                </Link>
                            </article>
                        </ScrollReveal>
                    </div>
                </div>
            </section>

            <section className="hiw-security-section">
                <div className="container">
                    <ScrollReveal>
                        <div className="hiw-section-header">
                            <div className="brand-badge badge-center" style={{ display: 'inline-flex', marginBottom: 16 }}>
                                <span>BUILT-IN SECURITY</span>
                            </div>
                            <h2 className="hiw-section-h2">Every layer protected</h2>
                            <p className="hiw-section-sub">
                                Six layers of enterprise-grade security — activated automatically, no configuration required.
                            </p>
                        </div>
                    </ScrollReveal>

                    <div className="hiw-sec-grid">
                        {SECURITY.map((item, i) => {
                            const Icon = item.icon;
                            return (
                                <ScrollReveal key={item.label} delay={(i % 4) + 1}>
                                    <article className={`hiw-sec-card hiw-sec-card-${item.color}`}>
                                        <div className={`hiw-sec-icon hiw-si-${item.color}`}>
                                            <Icon size={22} strokeWidth={2} />
                                        </div>
                                        <h3 className="hiw-sec-title">{item.label}</h3>
                                        <p className="hiw-sec-desc">{item.desc}</p>
                                    </article>
                                </ScrollReveal>
                            );
                        })}
                    </div>
                </div>
            </section>

            <section className="hiw-usecases-section">
                <div className="container">
                    <ScrollReveal>
                        <div className="hiw-section-header">
                            <div className="brand-badge badge-center" style={{ display: 'inline-flex', marginBottom: 16 }}>
                                <span>PERFECT FOR</span>
                            </div>
                            <h2 className="hiw-section-h2">Works for every industry</h2>
                            <p className="hiw-section-sub">
                                Trusted for secure sharing across healthcare, legal, finance, and more.
                            </p>
                        </div>
                    </ScrollReveal>

                    <div className="hiw-uc-grid">
                        {INDUSTRIES.map((item, i) => (
                            <ScrollReveal key={item.label} delay={(i % 4) + 1}>
                                <article className="hiw-uc-card">
                                    <span className={`hiw-uc-dot hiw-ui-${item.color}`} />
                                    <div>
                                        <h3 className="hiw-uc-title">{item.label}</h3>
                                        <p className="hiw-uc-desc">{item.desc}</p>
                                    </div>
                                </article>
                            </ScrollReveal>
                        ))}
                    </div>
                </div>
            </section>

            <section className="hiw-cta-outer">
                <div className="container">
                    <ScrollReveal>
                        <div className="hiw-cta-box">
                            <div className="hiw-cta-left">
                                <div className="brand-badge" style={{ display: 'inline-flex', marginBottom: 20 }}>
                                    <span>GET STARTED TODAY</span>
                                </div>
                                <h2 className="hiw-cta-h2">Ready to share data securely?</h2>
                                <p className="hiw-cta-p">
                                    Start in seconds. No credit card. Create a protected link and stay in control from the first send.
                                </p>
                                <div className="hiw-cta-btns">
                                    <Link href="/create-link" className="btn btn-primary btn-large">
                                        <span>Create Secure Link</span>
                                        <ArrowRight size={18} />
                                    </Link>
                                    <Link href="/services" className="btn btn-secondary btn-large">
                                        <span>Explore Services</span>
                                    </Link>
                                </div>
                                <div className="hiw-cta-trust">
                                    <span>
                                        <Lock size={14} /> End-to-end encrypted
                                    </span>
                                    <span>
                                        <Zap size={14} /> Instant setup
                                    </span>
                                    <span>
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
