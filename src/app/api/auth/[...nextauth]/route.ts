import NextAuth from 'next-auth';
import { NextRequest, NextResponse } from 'next/server';
import { authOptions } from '@/lib/auth';
import { checkLoginRateLimit, extractClientIP } from '@/lib/rate-limit';
import { logger } from '@/lib/logger';

const handler = NextAuth(authOptions);

function expectedAuthOrigin(): string | null {
    const raw = process.env.NEXTAUTH_URL;
    if (!raw) return null;
    try {
        return new URL(raw).origin;
    } catch {
        return null;
    }
}

/** Local Google OAuth hangs if Next is on :3001 while NEXTAUTH_URL is :3000. */
function devAuthHostMismatch(req: NextRequest): boolean {
    if (process.env.NODE_ENV !== 'development') return false;
    const expected = expectedAuthOrigin();
    return Boolean(expected && req.nextUrl.origin !== expected);
}

export async function GET(req: NextRequest, context: any) {
    return handler(req, context);
}

export async function POST(req: NextRequest, context: any) {
    if (devAuthHostMismatch(req)) {
        const expected = expectedAuthOrigin();
        logger.error(
            `[AUTH] Google sign-in blocked: request origin ${req.nextUrl.origin} does not match NEXTAUTH_URL ${expected}. Free port 3000 and open that URL.`,
        );
        return NextResponse.json({
            url: `${req.nextUrl.origin}/auth/error?error=HostMismatch`,
        });
    }

    const limited = await checkLoginRateLimit(extractClientIP(req.headers));
    if (!limited.allowed) {
        return NextResponse.json(
            { error: 'Too many sign-in attempts. Please try again later.' },
            { status: 429 },
        );
    }
    return handler(req, context);
}
