import Link from 'next/link';
import type { Metadata } from 'next';

export const metadata: Metadata = {
    title: '404 - Page Not Found',
    description: 'The page you are looking for does not exist.',
    robots: { index: false, follow: false },
};

export default function NotFound() {
    return (
        <main className="error-page">
            <div className="container" style={{ textAlign: 'center', paddingTop: '120px', paddingBottom: '80px' }}>
                <div className="error-icon" style={{
                    width: '80px',
                    height: '80px',
                    borderRadius: '50%',
                    background: 'rgba(14, 165, 233, 0.1)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    margin: '0 auto 24px',
                }}>
                    <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="#0ea5e9" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                        <circle cx="12" cy="12" r="10" />
                        <path d="M16 16s-1.5-2-4-2-4 2-4 2" />
                        <line x1="9" y1="9" x2="9.01" y2="9" />
                        <line x1="15" y1="9" x2="15.01" y2="9" />
                    </svg>
                </div>
                <h1 style={{
                    fontSize: 'clamp(3rem, 8vw, 6rem)',
                    fontWeight: 800,
                    background: 'linear-gradient(135deg, #0ea5e9, #8b5cf6)',
                    WebkitBackgroundClip: 'text',
                    WebkitTextFillColor: 'transparent',
                    marginBottom: '12px',
                }}>
                    404
                </h1>
                <h2 style={{
                    fontSize: '1.5rem',
                    fontWeight: 700,
                    color: '#f8fafc',
                    marginBottom: '12px',
                }}>
                    Page Not Found
                </h2>
                <p style={{
                    fontSize: '1rem',
                    color: '#94a3b8',
                    maxWidth: '400px',
                    margin: '0 auto 32px',
                    lineHeight: 1.6,
                }}>
                    The page you&apos;re looking for doesn&apos;t exist or has been moved.
                </p>
                <Link href="/" className="btn btn-primary">
                    Go Home
                </Link>
            </div>
        </main>
    );
}
