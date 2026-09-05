import type { Metadata } from 'next';

export const metadata: Metadata = {
    title: 'Terms of Service',
    description: 'Secure Protocol Terms of Service. Understand your rights and responsibilities when using our secure data sharing platform.',
};

export default function TermsPage() {
    return (
        <main className="legal-page">
            <div className="container">
                <div className="legal-card">
                    <h1 className="legal-title">Terms of Service</h1>
                    <p className="legal-updated">Last updated: February 2026</p>

                    <section className="legal-section">
                        <h2>1. Acceptance of Terms</h2>
                        <p>
                            By accessing or using Secure Protocol, you agree to be bound by these Terms of Service.
                            If you do not agree, you may not use the platform.
                        </p>
                    </section>

                    <section className="legal-section">
                        <h2>2. Service Description</h2>
                        <p>
                            Secure Protocol provides a secure data sharing platform that enables users to share
                            sensitive information through encrypted, time-limited, OTP-protected links.
                        </p>
                    </section>

                    <section className="legal-section">
                        <h2>3. User Responsibilities</h2>
                        <ul>
                            <li>You must provide accurate information during registration.</li>
                            <li>You are responsible for maintaining the confidentiality of your account.</li>
                            <li>You must not use the platform for illegal or unauthorized purposes.</li>
                            <li>You must not attempt to circumvent security measures.</li>
                            <li>You are responsible for the content you share through the platform.</li>
                        </ul>
                    </section>

                    <section className="legal-section">
                        <h2>4. Acceptable Use</h2>
                        <p>You agree not to:</p>
                        <ul>
                            <li>Share malicious software or harmful content</li>
                            <li>Attempt to bypass OTP verification or access controls</li>
                            <li>Use automated tools to abuse the platform</li>
                            <li>Violate applicable laws or regulations</li>
                        </ul>
                    </section>

                    <section className="legal-section">
                        <h2>5. Data Ownership</h2>
                        <p>
                            You retain full ownership of all data you share through Secure Protocol. We do not
                            claim any intellectual property rights over your content. Data is encrypted and
                            we cannot access its contents.
                        </p>
                    </section>

                    <section className="legal-section">
                        <h2>6. Limitation of Liability</h2>
                        <p>
                            Secure Protocol is provided &quot;as is&quot; without warranty of any kind. We shall not be
                            liable for any indirect, incidental, or consequential damages arising from use
                            of the platform.
                        </p>
                    </section>

                    <section className="legal-section">
                        <h2>7. Termination</h2>
                        <p>
                            We reserve the right to suspend or terminate your access to the platform at any
                            time for violations of these terms or for any other reason at our discretion.
                        </p>
                    </section>

                    <section className="legal-section">
                        <h2>8. Contact</h2>
                        <p>
                            For questions about these Terms, contact us at{' '}
                            <a href="mailto:legal@dataguardian.app" className="legal-link">legal@dataguardian.app</a>.
                        </p>
                    </section>
                </div>
            </div>
        </main>
    );
}
