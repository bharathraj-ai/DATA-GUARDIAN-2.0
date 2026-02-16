import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

/**
 * Known search engine referrer domains
 * If a request to a secure route comes from any of these, block it
 */
const SEARCH_ENGINE_DOMAINS = [
    'google.com', 'google.co', 'google.',
    'bing.com',
    'yahoo.com',
    'duckduckgo.com',
    'baidu.com',
    'yandex.com', 'yandex.ru',
    'ecosia.org',
    'ask.com',
    'aol.com',
    'search.',
];

/**
 * Check if the referrer is from a search engine
 */
function isFromSearchEngine(referer: string | null): boolean {
    if (!referer) return false;
    const lowerRef = referer.toLowerCase();
    return SEARCH_ENGINE_DOMAINS.some(domain => lowerRef.includes(domain));
}

/**
 * Middleware for Data Guardian
 * 
 * Security layers:
 * 1. Disables caching for all dynamic routes
 * 2. Sets X-Robots-Tag to prevent search engine indexing of secure routes
 * 3. Blocks access from search engine referrers (prevents link discovery via search)
 * 4. Sets Referrer-Policy to prevent token leakage in outbound requests
 * 
 * NOTE: Authentication is handled at page level using auth() wrapper
 * because Edge middleware doesn't support Prisma (database sessions)
 * 
 * IMPORTANT: /api/auth/* routes are excluded from middleware to prevent
 * interference with NextAuth's cookie handling (state, PKCE, session cookies)
 */
export function middleware(request: NextRequest) {
    const pathname = request.nextUrl.pathname;

    // NEVER intercept NextAuth API routes - they manage their own cookies
    if (pathname.startsWith('/api/auth')) {
        return NextResponse.next();
    }

    // Check if this is a secure route (share/view/revoke)
    const isSecureRoute =
        pathname.startsWith('/share/') ||
        pathname.startsWith('/view/') ||
        pathname.startsWith('/revoke/');

    // SECURITY: Block access from search engine referrers
    if (isSecureRoute) {
        const referer = request.headers.get('referer');
        if (isFromSearchEngine(referer)) {
            return new NextResponse(
                JSON.stringify({
                    error: 'Access Denied',
                    message: 'Secure links cannot be accessed from search engines. Please paste the link directly in your browser address bar.',
                }),
                {
                    status: 403,
                    headers: {
                        'Content-Type': 'application/json',
                        'X-Robots-Tag': 'noindex, nofollow, noarchive, nosnippet',
                    },
                }
            );
        }
    }

    const response = NextResponse.next();

    // SECURITY: Prevent search engines from indexing secure routes
    if (isSecureRoute) {
        response.headers.set('X-Robots-Tag', 'noindex, nofollow, noarchive, nosnippet');
        response.headers.set('Referrer-Policy', 'no-referrer');
    }

    // Disable caching for all dynamic routes
    if (
        isSecureRoute ||
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
        '/api/((?!auth).*)',
        '/auth/:path*',
    ],
};

