import { AsyncLocalStorage } from 'node:async_hooks';
import { headers } from 'next/headers';

type RequestStore = { requestId: string };

const requestContext = new AsyncLocalStorage<RequestStore>();

(globalThis as { __DG_REQUEST_ALS?: AsyncLocalStorage<RequestStore> }).__DG_REQUEST_ALS =
    requestContext;

const REQUEST_ID_RE = /^[\w\-:]{8,128}$/;

export function getRequestId(): string | undefined {
    return requestContext.getStore()?.requestId;
}

export function runWithRequestId<T>(requestId: string, fn: () => T): T {
    return requestContext.run({ requestId }, fn);
}

/**
 * Bind the inbound x-request-id (set by proxy.ts) to this async context so
 * logger JSON lines correlate without every call site passing meta.requestId.
 */
export async function bindRequestIdFromHeaders(): Promise<string | undefined> {
    try {
        const h = await headers();
        const incoming = h.get('x-request-id');
        const requestId =
            incoming && REQUEST_ID_RE.test(incoming) ? incoming : crypto.randomUUID();
        requestContext.enterWith({ requestId });
        return requestId;
    } catch {
        return undefined;
    }
}
