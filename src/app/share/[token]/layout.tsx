import { ReactNode } from 'react';

// Force dynamic rendering for share page
export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const fetchCache = 'force-no-store';
export const runtime = 'nodejs';

export default function ShareLayout({
    children,
}: {
    children: ReactNode;
}) {
    return <>{children}</>;
}
