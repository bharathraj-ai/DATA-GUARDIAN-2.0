'use client';

import { SessionProvider } from 'next-auth/react';
import { ReactNode } from 'react';
import { usePathname } from 'next/navigation';
import { isMarketingPath } from '@/lib/marketing-paths';

interface ProvidersProps {
    children: ReactNode;
}

export default function Providers({ children }: ProvidersProps) {
    const pathname = usePathname();
    const marketing = isMarketingPath(pathname);

    return (
        <SessionProvider
            // Explicit null on marketing skips the blocking /api/auth/session fetch.
            session={marketing ? null : undefined}
            refetchInterval={0}
            refetchOnWindowFocus={false}
            refetchWhenOffline={false}
        >
            {children}
        </SessionProvider>
    );
}
