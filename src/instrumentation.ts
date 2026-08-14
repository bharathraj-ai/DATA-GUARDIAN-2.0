/**
 * Next.js Instrumentation — runs once when the server starts.
 * Node-only work (Mongo warm + cleanup scheduler) lives in instrumentation-node.ts
 * so Edge never loads MongoDB / dns/promises.
 */
export async function register() {
    if (process.env.NEXT_RUNTIME === 'nodejs') {
        const { registerNode } = await import('./instrumentation-node');
        await registerNode();
    }
}
