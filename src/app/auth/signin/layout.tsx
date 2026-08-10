import type { Metadata } from 'next';

export const metadata: Metadata = {
    title: 'Sign In',
    description: 'Sign in to Secure Protocol with your Google account. Secure authentication with zero-trust architecture.',
    robots: {
        index: false,
        follow: false,
    },
};

export default function SignInLayout({
    children,
}: {
    children: React.ReactNode;
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
`,
                }}
            />
            {children}
        </>
    );
}
