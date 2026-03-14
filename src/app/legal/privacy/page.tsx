import type { Metadata } from 'next';

export const metadata: Metadata = {
    title: 'Privacy Policy',
    description: 'Data Guardian Privacy Policy. Learn how we protect your data with zero-knowledge architecture and end-to-end encryption.',
};

export default function PrivacyPolicyPage() {
    return (
        <main className="legal-page">
            <div className="container">
                <div className="legal-card">
                    <h1 className="legal-title">Privacy Policy</h1>
                    <p className="legal-updated">Last updated: February 2026</p>

                    <section className="legal-section">
                        <h2>1. Introduction</h2>
                        <p>
                            Data Guardian (&quot;we&quot;, &quot;us&quot;, &quot;our&quot;) is committed to protecting your privacy.
                            This Privacy Policy explains how we collect, use, and safeguard your information
                            when you use our secure data sharing platform.
                        </p>
                    </section>

                    <section className="legal-section">
                        <h2>2. Information We Collect</h2>
                        <p>We collect the following information:</p>
                        <ul>
                            <li><strong>Account Information:</strong> Your name and email address from your Google account when you sign in.</li>
                            <li><strong>Usage Data:</strong> Audit logs of link creation, access, and revocation events for security purposes.</li>
                            <li><strong>Shared Data:</strong> The data you choose to share through our platform, which is encrypted at rest using AES-256-GCM.</li>
                        </ul>
                    </section>

                    <section className="legal-section">
                        <h2>3. Zero-Knowledge Architecture</h2>
                        <p>
                            Data Guardian operates on a zero-knowledge principle. Your shared data is encrypted
                            before storage, and we do not have the ability to read the content of your shared files
                            or data. Encryption keys are derived per-session and never stored on our servers.
                        </p>
                    </section>

                    <section className="legal-section">
                        <h2>4. Data Retention</h2>
                        <p>
                            Shared data is automatically deleted when the secure link expires or is revoked.
                            Account information is retained as long as your account is active. Audit logs are
                            retained for security and compliance purposes.
                        </p>
                    </section>

                    <section className="legal-section">
                        <h2>5. Data Security</h2>
                        <p>We implement industry-leading security measures including:</p>
                        <ul>
                            <li>AES-256-GCM encryption for all shared data</li>
                            <li>HMAC-SHA256 for OTP hashing</li>
                            <li>Rate limiting to prevent brute-force attacks</li>
                            <li>Device and email binding for access control</li>
                            <li>Screenshot detection and automatic revocation</li>
                        </ul>
                    </section>

                    <section className="legal-section">
                        <h2>6. Third-Party Services</h2>
                        <p>We use the following third-party services:</p>
                        <ul>
                            <li><strong>Google OAuth:</strong> For secure authentication</li>
                            <li><strong>Upstash Redis:</strong> For rate limiting and session management</li>
                        </ul>
                    </section>

                    <section className="legal-section">
                        <h2>7. Contact</h2>
                        <p>
                            For privacy-related inquiries, please contact us at{' '}
                            <a href="mailto:privacy@dataguardian.app" className="legal-link">privacy@dataguardian.app</a>.
                        </p>
                    </section>
                </div>
            </div>
        </main>
    );
}
