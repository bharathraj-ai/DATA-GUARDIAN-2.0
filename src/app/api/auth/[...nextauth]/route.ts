import NextAuth from 'next-auth';
import { NextRequest, NextResponse } from 'next/server';
import { authOptions } from '@/lib/auth';
import { checkLoginRateLimit, extractClientIP } from '@/lib/rate-limit';

const handler = NextAuth(authOptions);

export async function GET(req: NextRequest, context: any) {
  return handler(req, context);
}

export async function POST(req: NextRequest, context: any) {
  const limited = await checkLoginRateLimit(extractClientIP(req.headers));
  if (!limited.allowed) {
    return NextResponse.json(
      { error: 'Too many sign-in attempts. Please try again later.' },
      { status: 429 },
    );
  }
  return handler(req, context);
}
