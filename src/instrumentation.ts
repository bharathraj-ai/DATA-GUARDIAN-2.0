/**
 * Next.js Instrumentation — runs once when the server starts.
 * Cleanup is disabled in development so the first page load is not
 * competing with Neon DB wake-ups / purge queries.
 */
export async function register() {
    if (process.env.NEXT_RUNTIME !== 'nodejs') return;

    // Dev: skip background purge — use Vercel cron / production only
    if (process.env.NODE_ENV === 'development') {
        console.log('[CLEANUP] Skipped in development (faster first page load)');
        return;
    }

    const CLEANUP_INTERVAL_MS = 10 * 60 * 1000;

    console.log('[CLEANUP] Background data purge scheduler starting...');

    // Wait 2 minutes after boot so traffic is served first
    setTimeout(async () => {
        try {
            const { executeCleanup } = await import('@/lib/cleanup-core');
            const result = await executeCleanup();
            if (result.deletedLinks > 0) {
                console.log(
                    `[CLEANUP] Initial purge: ${result.deletedLinks} links, ` +
                    `${result.deletedUserData} records, ${result.deletedFiles} files deleted`
                );
            }
        } catch (error) {
            console.error('[CLEANUP] Initial purge failed:', error instanceof Error ? error.message : 'Unknown');
        }
    }, 120_000);

    setInterval(async () => {
        try {
            const { executeCleanup } = await import('@/lib/cleanup-core');
            const result = await executeCleanup();
            if (result.deletedLinks > 0) {
                console.log(
                    `[CLEANUP] Scheduled purge: ${result.deletedLinks} links, ` +
                    `${result.deletedUserData} records, ${result.deletedFiles} files deleted`
                );
            }
        } catch (error) {
            console.error('[CLEANUP] Scheduled purge failed:', error instanceof Error ? error.message : 'Unknown');
        }
    }, CLEANUP_INTERVAL_MS);
}
