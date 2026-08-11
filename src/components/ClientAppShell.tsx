'use client';

import React from 'react';
import { usePathname } from 'next/navigation';
import Navbar from "@/components/Navbar";

interface Props {
    children: React.ReactNode;
    footer: React.ReactNode;
}

export default function ClientAppShell({ children, footer }: Props) {
    const pathname = usePathname();
    const isFullscreenEditor = pathname?.startsWith('/editor/');
    const hideSiteFooter =
        pathname?.startsWith('/auth/role-select') ||
        pathname?.startsWith('/auth/signin') ||
        pathname?.startsWith('/view/');

    if (isFullscreenEditor) {
        return (
            <div style={{ width: '100vw', height: '100vh', margin: 0, padding: 0, overflow: 'hidden' }}>
                <style jsx global>{`
                    body {
                        margin: 0 !important;
                        padding: 0 !important;
                        overflow: hidden !important;
                    }
                `}</style>
                {children}
            </div>
        );
    }

    return (
        <>
            <Navbar />
            <div id="main-content" style={{ background: hideSiteFooter ? '#f4f7fb' : '#FFFFFF', minHeight: '100vh' }}>{children}</div>
            {hideSiteFooter ? null : footer}
        </>
    );
}
