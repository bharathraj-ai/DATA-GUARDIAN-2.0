import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { validateCSRF } from '@/lib/security/csrf';
import { generateCspNonce, buildCspHeader } from '@/lib/security/csp';

function resolveRequestId(request: NextRequest): string {
    const incoming = request.headers.get('x-request-id');
    if (incoming && /^[\w\-:]{8,128}$/.test(incoming)) return incoming;
    return crypto.randomUUID();
}

/**
 * Next.js 16 Proxy / Middleware
 *
 * 1. Nonce-based Content Security Policy (SV-07):
 *    - Generates a fresh cryptographic nonce per request
 *    - Removes 'unsafe-inline' from script-src in production
 *    - Applies strict-dynamic and nonce validation
 *    - Injects nonce into request and response headers
 * 2. Correlation IDs (x-request-id)
 * 3. CSRF protection on mutating API endpoints
 */
export function proxy(request: NextRequest) {
    const requestId = resolveRequestId(request);
    const nonce = generateCspNonce();
    const pathname = request.nextUrl.pathname;
    const cspHeaderValue = buildCspHeader(nonce, { pathname });

    const requestHeaders = new Headers(request.headers);
    requestHeaders.set('x-request-id', requestId);
    requestHeaders.set('x-nonce', nonce);
    requestHeaders.set('Content-Security-Policy', cspHeaderValue);
    requestHeaders.set('content-security-policy', cspHeaderValue);

    const method = request.method.toUpperCase();

    // CSRF check on mutating custom API endpoints
    const isMutatingApi = (method === 'POST' || method === 'PUT' || method === 'PATCH' || method === 'DELETE') &&
        pathname.startsWith('/api/') &&
        !pathname.startsWith('/api/auth');

    if (isMutatingApi) {
        const csrfResult = validateCSRF(request);
        if (!csrfResult.allowed) {
            const res = NextResponse.json(
                { error: csrfResult.reason },
                { status: csrfResult.status },
            );
            res.headers.set('x-request-id', requestId);
            res.headers.set('x-nonce', nonce);
            res.headers.set('Content-Security-Policy', cspHeaderValue);
            return res;
        }
    }

    const res = NextResponse.next({ request: { headers: requestHeaders } });
    res.headers.set('x-request-id', requestId);
    res.headers.set('x-nonce', nonce);
    res.headers.set('Content-Security-Policy', cspHeaderValue);
    return res;
}

export { proxy as middleware };
export default proxy;

export const config = {
    matcher: [
        /*
         * Match all request paths except for:
         * - _next/static (static files)
         * - _next/image (image optimization files)
         * - favicon.ico (favicon file)
         * - robots.txt, sitemap.xml
         */
        {
            source: '/((?!_next/static|_next/image|favicon.ico|robots.txt|sitemap.xml).*)',
            missing: [
                { type: 'header', key: 'next-router-prefetch' },
                { type: 'header', key: 'purpose', value: 'prefetch' },
            ],
        },
    ],
};
