'use client';

import { useEffect } from 'react';
import { AlertTriangle } from 'lucide-react';

export default function GlobalError({
    error,
    reset,
}: {
    error: Error & { digest?: string };
    reset: () => void;
}) {
    useEffect(() => {
        // Log the error for monitoring
        console.error('[GlobalError]', error);
    }, [error]);

    return (
        <html lang="en">
            <body style={{
                minHeight: '100vh',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: '#020617',
                color: '#f8fafc',
                fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
            }}>
                <div style={{
                    textAlign: 'center',
                    padding: '40px',
                    maxWidth: '500px',
                }}>
                    <div style={{
                        width: '64px',
                        height: '64px',
                        borderRadius: '50%',
                        background: 'rgba(239, 68, 68, 0.15)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        margin: '0 auto 24px',
                    }}>
                        <AlertTriangle size={32} color="#ef4444" />
                    </div>
                    <h1 style={{
                        fontSize: '24px',
                        fontWeight: 700,
                        marginBottom: '12px',
                    }}>
                        Something went wrong
                    </h1>
                    <p style={{
                        fontSize: '14px',
                        color: '#94a3b8',
                        marginBottom: '24px',
                        lineHeight: 1.6,
                    }}>
                        An unexpected error occurred. Please try again, or contact support if the issue persists.
                    </p>
                    <button
                        onClick={() => reset()}
                        style={{
                            padding: '12px 24px',
                            borderRadius: '12px',
                            border: 'none',
                            background: 'linear-gradient(135deg, #0ea5e9, #06b6d4)',
                            color: '#fff',
                            fontWeight: 600,
                            fontSize: '14px',
                            cursor: 'pointer',
                        }}
                    >
                        Try Again
                    </button>
                </div>
            </body>
        </html>
    );
}
