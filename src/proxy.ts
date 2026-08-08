import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { validateCSRF } from '@/lib/security/csrf';

/**
 * CSRF only on mutating custom APIs.
 * Auth + GET requests are excluded so session/page traffic stays fast.
 */
export function proxy(request: NextRequest) {
    const method = request.method.toUpperCase();
    if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') {
        return NextResponse.next();
    }

    const csrfResult = validateCSRF(request);
    if (!csrfResult.allowed) {
        return NextResponse.json(
            { error: csrfResult.reason },
            { status: csrfResult.status }
        );
    }

    return NextResponse.next();
}

export const config = {
    // Skip NextAuth + static-ish noise; only custom API mutations
    matcher: ['/api/((?!auth).*)'],
};
