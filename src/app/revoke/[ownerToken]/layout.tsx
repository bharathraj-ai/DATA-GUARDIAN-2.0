import { ReactNode } from 'react';

// Force dynamic rendering for revoke page
export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const fetchCache = 'force-no-store';
export const runtime = 'nodejs';

/** Owner revoke/manage page uses light card UI — lock body to light on first paint. */
export default function RevokeLayout({
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
  background: #FFFFFF !important;
  background-color: #FFFFFF !important;
  color: #0F172A !important;
}
#main-content {
  background: #FFFFFF !important;
  min-height: 100vh;
}
.app-page {
  animation: none !important;
  opacity: 1 !important;
  transform: none !important;
  background: #FFFFFF !important;
}
.revoke-wrapper {
  background: linear-gradient(145deg, #F8FAFC 0%, #EFF6FF 50%, #F1F5F9 100%) !important;
}
`,
                }}
            />
            {children}
        </>
    );
}
