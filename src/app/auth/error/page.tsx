'use client';

import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { Suspense } from 'react';

function ErrorContent() {
    const searchParams = useSearchParams();
    const error = searchParams.get('error');

    const errorMessages: Record<string, { title: string; description: string }> = {
        Configuration: {
            title: 'Configuration Error',
            description: 'There is a problem with the server configuration. Please contact support.',
        },
        AccessDenied: {
            title: 'Access Denied',
            description: 'You do not have permission to access this resource.',
        },
        Verification: {
            title: 'Verification Error',
            description: 'The verification link may have expired or already been used.',
        },
        Default: {
            title: 'Authentication Error',
            description: 'An error occurred during authentication. Please try again.',
        },
    };

    const { title, description } = errorMessages[error || 'Default'] || errorMessages.Default;

    return (
        <main className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900">
            <div className="w-full max-w-md p-8 text-center">
                {/* Error Icon */}
                <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-red-500/10 border border-red-500/20 mb-6">
                    <svg className="w-8 h-8 text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                    </svg>
                </div>

                {/* Error Message */}
                <h1 className="text-2xl font-bold text-white mb-2">{title}</h1>
                <p className="text-slate-400 mb-8">{description}</p>

                {/* Actions */}
                <div className="flex flex-col gap-3">
                    <Link
                        href="/auth/signin"
                        className="px-6 py-3 rounded-xl bg-gradient-to-r from-cyan-500 to-blue-600 text-white font-medium hover:from-cyan-600 hover:to-blue-700 transition-all duration-200"
                    >
                        Try Again
                    </Link>
                    <Link
                        href="/"
                        className="px-6 py-3 rounded-xl border border-slate-600 text-slate-300 hover:bg-slate-800 transition-all duration-200"
                    >
                        Go Home
                    </Link>
                </div>
            </div>
        </main>
    );
}

export default function AuthErrorPage() {
    return (
        <Suspense fallback={
            <main className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900">
                <div className="text-white">Loading...</div>
            </main>
        }>
            <ErrorContent />
        </Suspense>
    );
}
