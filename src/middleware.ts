import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

export function middleware(request: NextRequest) {
    const response = NextResponse.next();

    // Disable caching for all dynamic routes
    if (
        request.nextUrl.pathname.startsWith('/share/') ||
        request.nextUrl.pathname.startsWith('/view/') ||
        request.nextUrl.pathname.startsWith('/revoke/') ||
        request.nextUrl.pathname.startsWith('/signup') ||
        request.nextUrl.pathname.startsWith('/api/')
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
    ],
};
