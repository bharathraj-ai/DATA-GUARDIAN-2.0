/**
 * Next.js Instrumentation — runs once when the server starts.
 * 
 * Used here to start a background cleanup interval that automatically
 * purges expired/revoked secure links and ALL associated data from the
 * database every 10 minutes.
 * 
 * This ensures data deletion even if:
 * - No one visits the expired link
 * - The Vercel Cron is not configured
 * - External cron services are unavailable
 * 
 * @see https://nextjs.org/docs/app/building-your-application/optimizing/instrumentation
 */
export async function register() {
    // Only run cleanup scheduler on the server (not edge runtime)
    if (process.env.NEXT_RUNTIME === 'nodejs') {
        const CLEANUP_INTERVAL_MS = 10 * 60 * 1000; // 10 minutes

        console.log('[CLEANUP] Background data purge scheduler starting...');

        // Initial cleanup after 30 seconds (let the server stabilize first)
        setTimeout(async () => {
            try {
                const { cleanupExpiredData } = await import('@/actions/cleanup');
                const result = await cleanupExpiredData();
                if (result.deletedLinks > 0) {
                    console.log(
                        `[CLEANUP] Initial purge: ${result.deletedLinks} links, ` +
                        `${result.deletedUserData} records, ${result.deletedFiles} files deleted`
                    );
                } else {
                    console.log('[CLEANUP] Initial purge: no expired data found');
                }
            } catch (error) {
                console.error('[CLEANUP] Initial purge failed:', error instanceof Error ? error.message : 'Unknown');
            }
        }, 30_000);

        // Recurring cleanup every 10 minutes
        setInterval(async () => {
            try {
                const { cleanupExpiredData } = await import('@/actions/cleanup');
                const result = await cleanupExpiredData();
                if (result.deletedLinks > 0) {
                    console.log(
                        `[CLEANUP] Scheduled purge: ${result.deletedLinks} links, ` +
                        `${result.deletedUserData} records, ${result.deletedFiles} files deleted`
                    );
                }
                // Silence when nothing to clean (avoid log noise)
            } catch (error) {
                console.error('[CLEANUP] Scheduled purge failed:', error instanceof Error ? error.message : 'Unknown');
            }
        }, CLEANUP_INTERVAL_MS);
    }
}
