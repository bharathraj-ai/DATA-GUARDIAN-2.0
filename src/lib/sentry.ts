/**
 * Optional Sentry. No-ops unless SENTRY_DSN is set.
 * Loaded lazily so local/dev/CI without the DSN never talks to Sentry.
 */

let initStarted = false;

export function initSentry(): void {
    if (initStarted || !process.env.SENTRY_DSN) return;
    initStarted = true;

    void import('@sentry/node')
        .then((Sentry) => {
            Sentry.init({
                dsn: process.env.SENTRY_DSN,
                environment: process.env.VERCEL_ENV || process.env.NODE_ENV,
                tracesSampleRate: process.env.NODE_ENV === 'production' ? 0.1 : 0,
            });
        })
        .catch(() => {
            initStarted = false;
        });
}

export function captureException(error: unknown, extra?: Record<string, unknown>): void {
    if (!process.env.SENTRY_DSN) return;

    void import('@sentry/node')
        .then((Sentry) => {
            Sentry.captureException(error, extra ? { extra } : undefined);
        })
        .catch(() => {});
}
