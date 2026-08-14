/**
 * Node.js-only instrumentation. Imported from instrumentation.ts only when
 * NEXT_RUNTIME === 'nodejs' so Edge never loads MongoDB / dns/promises.
 *
 * Cleanup is disabled in development so the first page load is not
 * competing with Neon DB wake-ups / purge queries.
 * On Vercel, /api/cleanup cron is the source of truth (isolates must not each run purge).
 */
import { logger } from '@/lib/logger';

async function warmMongo() {
    try {
        const { isMongoConfigured, warmMongoConnection } = await import('@/lib/mongo/client');
        if (!isMongoConfigured()) return;
        await warmMongoConnection();
    } catch (error) {
        logger.warn('[Mongo] Warm connect skipped', {
            error: error instanceof Error ? error.message : String(error),
        });
    }
}

export async function registerNode() {
    void warmMongo();

    if (process.env.NODE_ENV === 'development') {
        logger.info('[CLEANUP] Skipped in development (faster first page load)');
        return;
    }

    if (process.env.VERCEL) {
        logger.info('[CLEANUP] Skipped on Vercel (cron /api/cleanup is source of truth)');
        return;
    }

    const CLEANUP_INTERVAL_MS = 10 * 60 * 1000;

    logger.info('[CLEANUP] Background data purge scheduler starting...');

    // Wait 2 minutes after boot so traffic is served first
    setTimeout(async () => {
        try {
            const { executeCleanup } = await import('@/lib/cleanup-core');
            const result = await executeCleanup();
            if (result.deletedLinks > 0) {
                logger.info(
                    `[CLEANUP] Initial purge: ${result.deletedLinks} links, ` +
                    `${result.deletedUserData} records, ${result.deletedFiles} files deleted`
                );
            }
        } catch (error) {
            logger.error('[CLEANUP] Initial purge failed:', error);
        }
    }, 120_000);

    setInterval(async () => {
        try {
            const { executeCleanup } = await import('@/lib/cleanup-core');
            const result = await executeCleanup();
            if (result.deletedLinks > 0) {
                logger.info(
                    `[CLEANUP] Scheduled purge: ${result.deletedLinks} links, ` +
                    `${result.deletedUserData} records, ${result.deletedFiles} files deleted`
                );
            }
        } catch (error) {
            logger.error('[CLEANUP] Scheduled purge failed:', error);
        }
    }, CLEANUP_INTERVAL_MS);
}
