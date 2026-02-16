'use client';

import { SessionProvider } from 'next-auth/react';
import { ReactNode } from 'react';

interface ProvidersProps {
    children: ReactNode;
}

export default function Providers({ children }: ProvidersProps) {
    return (
        <SessionProvider
            // Reduce session polling: check every 5 minutes instead of default 0 (every request)
            refetchInterval={5 * 60}
            // Only refetch when window is focused (saves API calls when tab is inactive)
            refetchOnWindowFocus={true}
        >
            {children}
        </SessionProvider>
    );
}
