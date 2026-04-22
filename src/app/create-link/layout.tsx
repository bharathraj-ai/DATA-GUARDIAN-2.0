import { ReactNode } from 'react';

// Force dynamic rendering for create-link page
export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const fetchCache = 'force-no-store';
export const runtime = 'nodejs';

export default function CreateLinkLayout({
    children,
}: {
    children: ReactNode;
}) {
    return <>{children}</>;
}
