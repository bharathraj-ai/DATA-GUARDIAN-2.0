import { NextRequest, NextResponse } from 'next/server';
import { isRedisConfigured } from '@/lib/redis-helpers';

/**
 * Liveness: GET /api/health
 * Readiness: GET /api/health?ready=1  (pings DB + Redis with timeouts)
 */
export async function GET(req: NextRequest) {
    const deep = req.nextUrl.searchParams.get('ready') === '1' || req.nextUrl.searchParams.get('deep') === '1';
    const payload: {
        status: 'healthy' | 'unhealthy';
        timestamp: string;
        version: string;
        uptime: number;
        checks?: Record<string, 'ok' | 'error' | 'skipped'>;
    } = {
        status: 'healthy',
        timestamp: new Date().toISOString(),
        version: process.env.npm_package_version || '2.0.0',
        uptime: process.uptime(),
    };

    const headers = { 'Cache-Control': 'no-cache, no-store, must-revalidate' };

    if (!deep) {
        return NextResponse.json(payload, { status: 200, headers });
    }

    const checks: Record<string, 'ok' | 'error' | 'skipped'> = {
        db: 'skipped',
        redis: 'skipped',
    };

    const timeout = (ms: number) =>
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error('timeout')), ms));

    try {
        const { prisma } = await import('@/lib/prisma');
        await Promise.race([prisma.$queryRaw`SELECT 1`, timeout(2500)]);
        checks.db = 'ok';
    } catch {
        checks.db = 'error';
    }

    if (isRedisConfigured()) {
        try {
            const redis = (await import('@/lib/redis')).default;
            await Promise.race([redis.ping(), timeout(2500)]);
            checks.redis = 'ok';
        } catch {
            checks.redis = 'error';
        }
    }

    payload.checks = checks;
    payload.status = checks.db === 'ok' ? 'healthy' : 'unhealthy';
    return NextResponse.json(payload, {
        status: payload.status === 'healthy' ? 200 : 503,
        headers,
    });
}
