import type { Metadata } from 'next';
import NotFoundClient from '@/components/NotFoundClient';

export const metadata: Metadata = {
    title: '404 - Page Not Found',
    description: 'The page you are looking for does not exist. Play Shield Run while you find your way back.',
    robots: { index: false, follow: false },
};

export default function NotFound() {
    return <NotFoundClient />;
}
