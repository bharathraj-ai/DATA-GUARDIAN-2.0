import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { validateCSRF } from '@/lib/security/csrf';

export function middleware(request: NextRequest) {
    const response = NextResponse.next();

    // CSRF Protection for custom API routes, except NextAuth which has its own protection
    if (request.nextUrl.pathname.startsWith('/api/') && !request.nextUrl.pathname.startsWith('/api/auth/')) {
        const csrfResult = validateCSRF(request);
        if (!csrfResult.allowed) {
            return NextResponse.json(
                { error: csrfResult.reason },
                { status: csrfResult.status }
            );
        }
    }

    // Security headers (applied to all responses)
    response.headers.set('X-Content-Type-Options', 'nosniff');
    response.headers.set('X-Frame-Options', 'DENY');
    response.headers.set('X-XSS-Protection', '1; mode=block');
    response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
    response.headers.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');

    // HSTS — only in production (HTTPS)
    if (process.env.NODE_ENV === 'production') {
        response.headers.set(
            'Strict-Transport-Security',
            'max-age=63072000; includeSubDomains; preload'
        );
    }

    return response;
}

export const config = {
    matcher: [
        /*
         * Match all request paths except for the ones starting with:
         * - _next/static (static files)
         * - _next/image (image optimization files)
         * - favicon.ico (favicon file)
         */
        '/((?!_next/static|_next/image|favicon.ico).*)',
    ],
};
