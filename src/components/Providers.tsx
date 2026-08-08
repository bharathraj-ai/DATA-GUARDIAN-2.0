'use client';

import { SessionProvider } from 'next-auth/react';
import { ReactNode } from 'react';

interface ProvidersProps {
    children: ReactNode;
}

export default function Providers({ children }: ProvidersProps) {
    return (
        <SessionProvider
            // JWT sessions are cheap, but avoid hammering /api/auth/session on every focus/nav
            refetchInterval={10 * 60}
            refetchOnWindowFocus={false}
        >
            {children}
        </SessionProvider>
    );
}
