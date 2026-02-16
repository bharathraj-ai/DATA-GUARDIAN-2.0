import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

/**
 * Middleware for Data Guardian
 * 
 * - Disables caching for all dynamic routes
 * - Sets security headers
 * 
 * NOTE: Authentication is handled at page level using auth() wrapper
 * because Edge middleware doesn't support Prisma (database sessions)
 */
export function middleware(request: NextRequest) {
    const pathname = request.nextUrl.pathname;

    const response = NextResponse.next();

    // Disable caching for all dynamic routes
    if (
        pathname.startsWith('/share/') ||
        pathname.startsWith('/view/') ||
        pathname.startsWith('/revoke/') ||
        pathname.startsWith('/signup') ||
        pathname.startsWith('/api/') ||
        pathname.startsWith('/auth/')
    ) {
        response.headers.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
        response.headers.set('Pragma', 'no-cache');
        response.headers.set('Expires', '0');
        response.headers.set('Surrogate-Control', 'no-store');
    }

    return response;
}

export const config = {
    matcher: [
        '/share/:path*',
        '/view/:path*',
        '/revoke/:path*',
        '/signup',
        '/api/:path*',
        '/auth/:path*',
    ],
};
