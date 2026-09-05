'use client';

import type { ReactNode } from 'react';
import { usePathname } from 'next/navigation';
import Providers from '@/components/Providers';
import { isMarketingPath } from '@/lib/marketing-paths';

/**
 * SessionProvider (and its /api/auth/session fetch) only wraps authenticated app
 * routes. Marketing pages stay a static RSC + chrome tree.
 */
export default function AppSessionGate({ children }: { children: ReactNode }) {
    const pathname = usePathname();
    if (isMarketingPath(pathname)) {
        return <>{children}</>;
    }
    return <Providers>{children}</Providers>;
}
