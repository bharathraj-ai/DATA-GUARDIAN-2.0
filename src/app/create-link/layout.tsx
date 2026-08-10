import { ReactNode } from 'react';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const fetchCache = 'force-no-store';
export const runtime = 'nodejs';

export default function CreateLinkLayout({ children }: { children: ReactNode }) {
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
`,
                }}
            />
            {children}
        </>
    );
}
