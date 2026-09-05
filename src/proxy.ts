import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { validateCSRF } from '@/lib/security/csrf';

function resolveRequestId(request: NextRequest): string {
    const incoming = request.headers.get('x-request-id');
    if (incoming && /^[\w\-:]{8,128}$/.test(incoming)) return incoming;
    return crypto.randomUUID();
}

function buildCsp(nonce: string): string {
    const isDev = process.env.NODE_ENV === 'development';
    return [
        "default-src 'self'",
        // CSP3 ignores 'unsafe-inline' when a nonce is present; kept for older browsers.
        `script-src 'self' 'nonce-${nonce}' 'strict-dynamic' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ''}`,
        "script-src-attr 'none'",
        "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
        "font-src 'self' https://fonts.gstatic.com",
        "img-src 'self' data: blob: https://lh3.googleusercontent.com https://avatars.githubusercontent.com",
        "connect-src 'self' https://*.upstash.io https://*.neon.tech",
        "frame-src 'self' blob: data:",
        "frame-ancestors 'none'",
        "base-uri 'self'",
        "form-action 'self'",
        "object-src 'none'",
    ].join('; ');
}

/**
 * Request IDs, CSP nonce, and CSRF on mutating custom APIs.
 * NextAuth and Server Actions skip CSRF here (Next origin check / OAuth).
 */
export function proxy(request: NextRequest) {
    const requestId = resolveRequestId(request);
    const nonce = crypto.randomUUID().replace(/-/g, '');
    const requestHeaders = new Headers(request.headers);
    requestHeaders.set('x-request-id', requestId);
    requestHeaders.set('x-nonce', nonce);

    const method = request.method.toUpperCase();
    const path = request.nextUrl.pathname;
    const skipCsrf =
        method === 'GET' ||
        method === 'HEAD' ||
        method === 'OPTIONS' ||
        path.startsWith('/api/auth') ||
        !path.startsWith('/api/');

    if (!skipCsrf) {
        const csrfResult = validateCSRF(request);
        if (!csrfResult.allowed) {
            const res = NextResponse.json(
                { error: csrfResult.reason },
                { status: csrfResult.status },
            );
            res.headers.set('x-request-id', requestId);
            res.headers.set('Content-Security-Policy', buildCsp(nonce));
            return res;
        }
    }

    const res = NextResponse.next({ request: { headers: requestHeaders } });
    res.headers.set('x-request-id', requestId);
    res.headers.set('Content-Security-Policy', buildCsp(nonce));
    return res;
}

export const config = {
    matcher: [
        '/((?!_next/static|_next/image|favicon.ico|fonts/|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)',
    ],
};
