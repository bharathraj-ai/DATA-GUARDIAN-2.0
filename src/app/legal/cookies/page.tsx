import type { Metadata } from 'next';

export const metadata: Metadata = {
    title: 'Cookie Policy',
    description: 'Data Guardian Cookie Policy. Learn about the minimal cookies we use for authentication and security.',
};

export default function CookiePolicyPage() {
    return (
        <main className="legal-page">
            <div className="container">
                <div className="legal-card">
                    <h1 className="legal-title">Cookie Policy</h1>
                    <p className="legal-updated">Last updated: February 2026</p>

                    <section className="legal-section">
                        <h2>1. What Are Cookies</h2>
                        <p>
                            Cookies are small text files stored on your device when you visit a website.
                            They are used to remember your preferences, authentication status, and other
                            information that improves your browsing experience.
                        </p>
                    </section>

                    <section className="legal-section">
                        <h2>2. Cookies We Use</h2>
                        <p>Data Guardian uses only essential cookies required for the platform to function:</p>

                        <div className="cookie-table-wrapper">
                            <table className="cookie-table">
                                <thead>
                                    <tr>
                                        <th>Cookie Name</th>
                                        <th>Purpose</th>
                                        <th>Duration</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    <tr>
                                        <td><code>next-auth.session-token</code></td>
                                        <td>Authentication session management</td>
                                        <td>Session</td>
                                    </tr>
                                    <tr>
                                        <td><code>next-auth.csrf-token</code></td>
                                        <td>Cross-site request forgery protection</td>
                                        <td>Session</td>
                                    </tr>
                                    <tr>
                                        <td><code>next-auth.callback-url</code></td>
                                        <td>Redirect after authentication</td>
                                        <td>Session</td>
                                    </tr>
                                </tbody>
                            </table>
                        </div>
                    </section>

                    <section className="legal-section">
                        <h2>3. No Tracking Cookies</h2>
                        <p>
                            We do <strong>not</strong> use any analytics, advertising, or tracking cookies.
                            Data Guardian does not track your browsing behavior across other websites.
                        </p>
                    </section>

                    <section className="legal-section">
                        <h2>4. Managing Cookies</h2>
                        <p>
                            You can control and delete cookies through your browser settings. Please note
                            that disabling essential cookies will prevent you from using authenticated
                            features of Data Guardian.
                        </p>
                    </section>

                    <section className="legal-section">
                        <h2>5. Contact</h2>
                        <p>
                            For questions about our cookie usage, contact us at{' '}
                            <a href="mailto:privacy@dataguardian.app" className="legal-link">privacy@dataguardian.app</a>.
                        </p>
                    </section>
                </div>
            </div>
        </main>
    );
}
