import { ReactNode } from 'react';
import { Metadata } from 'next';

// Force dynamic rendering for view page
export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const fetchCache = 'force-no-store';
export const runtime = 'nodejs';

// SECURITY: Prevent search engines from indexing secure view links
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

/**
 * Vendor /view uses a light profile theme, but the app shell defaults to a dark body.
 * Inject light theme on the server so the first paint never flashes dark.
 */
export default function ViewLayout({
    children,
}: {
    children: ReactNode;
}) {
    return (
        <>
            <style
                dangerouslySetInnerHTML={{
                    __html: `
html, body {
  background: #F8FAFC !important;
  background-color: #F8FAFC !important;
  color: #0F172A !important;
}
#main-content {
  background: transparent !important;
  min-height: 100vh;
}
.app-page {
  animation: none !important;
  opacity: 1 !important;
  transform: none !important;
}
`,
                }}
            />
            {children}
        </>
    );
}
