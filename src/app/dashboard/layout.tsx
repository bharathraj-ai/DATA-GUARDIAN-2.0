import { ReactNode } from 'react';

/**
 * Owner/vendor dashboard shell — lock light theme on first paint
 * so navigation never flashes a dark loading screen.
 */
export default function DashboardLayout({ children }: { children: ReactNode }) {
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
