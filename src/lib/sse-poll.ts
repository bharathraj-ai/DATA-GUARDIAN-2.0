/**
 * SSE kill-switch poll interval.
 * Redis is checked every tick; Postgres is reconciled less often by the stream route.
 * 8s keeps revoke latency acceptable while cutting Redis chatter vs the old 3s loop.
 */
export const SSE_POLL_MS = 8_000;
