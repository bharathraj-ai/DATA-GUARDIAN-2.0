import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

export function middleware(request: NextRequest) {
    const response = NextResponse.next();

    // CSRF Protection for custom API routes
    if (request.nextUrl.pathname.startsWith('/api/')) {
        const method = request.method;
        const isMutating = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method);

        if (isMutating) {
            // Origin validation (Fail-closed on origin mismatch)
            const origin = request.headers.get('origin');
            const host = request.headers.get('host');

            if (!origin || !host) {
                // Allow server actions (Next.js sets x-action-id header)
                const isServerAction = request.headers.get('next-action') !== null;
                if (!isServerAction) {
                    console.warn('[CSRF] Blocked: Missing Origin/Host', {
                        path: request.nextUrl.pathname,
                        method,
                    });
                    return NextResponse.json(
                        { error: 'CSRF Violation: Missing Origin/Host' },
                        { status: 403 }
                    );
                }
            } else {
                try {
                    const originHost = new URL(origin).host;
                    if (originHost !== host) {
                        console.warn('[CSRF] Blocked: Origin mismatch', {
                            origin: originHost,
                            host,
                        });
                        return NextResponse.json(
                            { error: 'CSRF Violation: Origin mismatch' },
                            { status: 403 }
                        );
                    }
                } catch {
                    return NextResponse.json(
                        { error: 'CSRF Violation: Invalid Origin' },
                        { status: 403 }
                    );
                }
            }
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
