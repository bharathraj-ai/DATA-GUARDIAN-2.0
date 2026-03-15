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
    return <>{children}</>;
}
