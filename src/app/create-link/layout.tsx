import { ReactNode } from 'react';

// Client page with session-gated UI — no need to force-dynamic the whole route tree
export default function CreateLinkLayout({
    children,
}: {
    children: ReactNode;
}) {
    return <>{children}</>;
}
