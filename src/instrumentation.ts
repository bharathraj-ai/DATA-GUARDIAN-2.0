/**
 * Next.js Instrumentation — runs once when the server starts.
 * Node-only work (secret checks, Sentry, Mongo warm, cleanup scheduler)
 * lives in instrumentation-node.ts so Edge never loads MongoDB / dns/promises.
 */
export async function register() {
    if (process.env.NEXT_RUNTIME === 'nodejs') {
        const { registerNode } = await import('./instrumentation-node');
        await registerNode();
    }
}

export async function onRequestError(
    error: { digest: string } & Error,
    _request: { path: string; method: string; headers: { [key: string]: string } },
    _context: { routerKind: 'Pages Router' | 'App Router'; routePath: string; routeType: string },
) {
    if (process.env.NEXT_RUNTIME !== 'nodejs') return;
    const { captureException } = await import('./lib/sentry');
    captureException(error, { digest: error.digest, path: _request.path, method: _request.method });
}
