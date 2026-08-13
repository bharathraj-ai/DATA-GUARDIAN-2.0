import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { validateCSRF } from '@/lib/security/csrf';

function resolveRequestId(request: NextRequest): string {
    const incoming = request.headers.get('x-request-id');
    if (incoming && /^[\w\-:]{8,128}$/.test(incoming)) return incoming;
    return crypto.randomUUID();
}

/**
 * CSRF on mutating custom APIs + request correlation IDs.
 * Auth + GET requests skip CSRF so session/page traffic stays fast.
 */
export function proxy(request: NextRequest) {
    const requestId = resolveRequestId(request);
    const requestHeaders = new Headers(request.headers);
    requestHeaders.set('x-request-id', requestId);

    const method = request.method.toUpperCase();
    if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') {
        const res = NextResponse.next({ request: { headers: requestHeaders } });
        res.headers.set('x-request-id', requestId);
        return res;
    }

    const csrfResult = validateCSRF(request);
    if (!csrfResult.allowed) {
        const res = NextResponse.json(
            { error: csrfResult.reason },
            { status: csrfResult.status },
        );
        res.headers.set('x-request-id', requestId);
        return res;
    }

    const res = NextResponse.next({ request: { headers: requestHeaders } });
    res.headers.set('x-request-id', requestId);
    return res;
}

export const config = {
    matcher: ['/api/((?!auth).*)'],
};
