'use client';

import React, { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import Navbar from "@/components/Navbar";

interface Props {
    children: React.ReactNode;
    footer: React.ReactNode;
}

export default function ClientAppShell({ children, footer }: Props) {
    const pathname = usePathname();
    const [hideFooterOverride, setHideFooterOverride] = useState(false);
    const isFullscreenEditor = pathname?.startsWith('/editor/');
    const hideChrome = hideFooterOverride;
    const hideSiteFooter =
        hideChrome ||
        pathname?.startsWith('/auth/role-select') ||
        pathname?.startsWith('/auth/signin') ||
        pathname?.startsWith('/view/');

    useEffect(() => {
        const sync = () => {
            setHideFooterOverride(!!document.querySelector('[data-sp-404-page]'));
        };
        sync();
        const root = document.getElementById('main-content') ?? document.body;
        const obs = new MutationObserver(sync);
        obs.observe(root, { childList: true, subtree: true, attributes: true, attributeFilter: ['data-sp-404-page'] });
        return () => obs.disconnect();
    }, [pathname]);

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
            {hideChrome ? null : <Navbar />}
            <div id="main-content" style={{ background: hideSiteFooter ? '#f4f7fb' : '#FFFFFF', minHeight: '100vh' }}>{children}</div>
            {hideSiteFooter ? null : footer}
        </>
    );
}
