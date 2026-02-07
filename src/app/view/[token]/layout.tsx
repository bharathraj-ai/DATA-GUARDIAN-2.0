import { ReactNode } from 'react';

// Force dynamic rendering for view page
export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const fetchCache = 'force-no-store';
export const runtime = 'nodejs';

export default function ViewLayout({
    children,
}: {
    children: ReactNode;
}) {
    return <>{children}</>;
}
