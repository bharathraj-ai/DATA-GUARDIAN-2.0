import { NextResponse } from 'next/server';
import { cleanupExpiredData } from '@/actions/cleanup';

export const dynamic = 'force-dynamic'; // Prevent static generation during build

// This endpoint can be called by a cron job service (e.g., Vercel Cron, external cron)
// Add authorization in production

export async function GET(request: Request) {
    // In production, verify cron secret
    const authHeader = request.headers.get('authorization');
    const cronSecret = process.env.CRON_SECRET;

    if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const result = await cleanupExpiredData();

    const headers = {
        'Cache-Control': 'no-cache, no-store, must-revalidate, max-age=0',
        'Pragma': 'no-cache',
        'Expires': '0',
    };

    if (result.success) {
        return NextResponse.json({
            message: 'Cleanup completed',
            deletedLinks: result.deletedLinks,
            deletedUsers: result.deletedUsers,
        }, { headers });
    }

    return NextResponse.json({ error: result.error }, { status: 500, headers });
}
