import { ReactNode } from 'react';
import { Metadata } from 'next';

// Force dynamic rendering for share page
export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const fetchCache = 'force-no-store';
export const runtime = 'nodejs';

// SECURITY: Prevent search engines from indexing secure share links
export const metadata: Metadata = {
    robots: {
        index: false,
        follow: false,
        noarchive: true,
        nosnippet: true,
        noimageindex: true,
        nocache: true,
    },
    // No Open Graph or Twitter card metadata — prevents link previews in chat apps
};

export default function ShareLayout({
    children,
}: {
    children: ReactNode;
}) {
    return <>{children}</>;
}
