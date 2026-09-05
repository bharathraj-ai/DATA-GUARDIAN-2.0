/**
 * Centralized logging for Secure Protocol.
 * Production: one JSON object per line (stdout/stderr) so log drains can parse it.
 * Development: human-readable lines. Request IDs come from AsyncLocalStorage
 * (proxy.ts x-request-id) or meta.requestId.
 * Redaction follows OWASP Logging Cheat Sheet (A09:2021).
 *
 * This file must stay Edge-safe (used by proxy CSRF). Do not import Node-only
 * modules here — request ALS is read from globalThis when Node has bound it.
 */

type RequestAls = { getStore: () => { requestId?: string } | undefined };

function getRequestId(): string | undefined {
    try {
        const als = (globalThis as { __DG_REQUEST_ALS?: RequestAls }).__DG_REQUEST_ALS;
        return als?.getStore()?.requestId;
    } catch {
        return undefined;
    }
}

export function redactEmail(email: string | null | undefined): string {
    if (!email) return 'unknown';
    const parts = email.split('@');
    if (parts.length !== 2) return '***';
    const [local, domain] = parts;
    if (local.length <= 1) return `*@${domain}`;
    return `${local.charAt(0)}***@${domain}`;
}

export function redactIp(ip: string | null | undefined): string {
    if (!ip) return 'unknown';

    if (ip.includes('.')) {
        const parts = ip.split('.');
        if (parts.length === 4) {
            return `${parts[0]}.${parts[1]}.xxx.xxx`;
        }
    }

    if (ip.includes(':')) {
        const parts = ip.split(':');
        if (parts.length > 2) {
            return `${parts[0]}:${parts[1]}:xxxx:xxxx:xxxx:xxxx:xxxx:xxxx`;
        }
    }

    return '***.***.***.***';
}

export function redactToken(token: string | null | undefined): string {
    if (!token) return 'unknown';
    return token.substring(0, 4) + '***';
}

export function redactSessionId(sessionId: string | null | undefined): string {
    if (!sessionId) return 'unknown';
    return sessionId.substring(0, 6) + '***';
}

type LogLevel = 'INFO' | 'WARN' | 'ERROR' | 'SECURITY' | 'DEBUG';

function splitMeta(meta?: unknown): { requestId?: string; rest: unknown } {
    const requestIdFromAls = getRequestId();
    if (!meta || typeof meta !== 'object') {
        return { requestId: requestIdFromAls, rest: meta };
    }
    const copy = { ...(meta as Record<string, unknown>) };
    const requestId =
        typeof copy.requestId === 'string' ? copy.requestId : requestIdFromAls;
    delete copy.requestId;
    return {
        requestId,
        rest: Object.keys(copy).length > 0 ? copy : undefined,
    };
}

function emit(level: LogLevel, message: string, meta?: unknown) {
    const { requestId, rest } = splitMeta(meta);
    const jsonLogs = process.env.NODE_ENV === 'production';

    if (jsonLogs) {
        const payload: Record<string, unknown> = {
            ts: new Date().toISOString(),
            level,
            msg: message,
        };
        if (requestId) payload.requestId = requestId;
        if (rest !== undefined) payload.meta = rest;
        const line = JSON.stringify(payload) + '\n';
        if (level === 'ERROR') process.stderr.write(line);
        else process.stdout.write(line);
        return;
    }

    const timestamp = new Date().toISOString();
    let out = `[${timestamp}] [${level}]${requestId ? ` [${requestId}]` : ''} ${message}`;
    if (rest !== undefined) {
        try {
            out += ` | ${JSON.stringify(rest)}`;
        } catch {
            out += ` | [Unserializable Metadata]`;
        }
    }
    if (level === 'ERROR') console.error(out);
    else if (level === 'WARN' || level === 'SECURITY') console.warn(out);
    else console.log(out);
}

export const logger = {
    info: (message: string, meta?: unknown) => {
        emit('INFO', message, meta);
    },

    warn: (message: string, meta?: unknown) => {
        emit('WARN', message, meta);
    },

    error: (message: string, error?: unknown, meta?: unknown) => {
        const errMsg = error instanceof Error ? error.message : error;
        emit('ERROR', message, { error: errMsg, ...(meta && typeof meta === 'object' ? meta : {}) });
        if (typeof window === 'undefined' && error && process.env.SENTRY_DSN) {
            void import('@/lib/sentry').then(({ captureException }) => {
                captureException(error, { message });
            }).catch(() => {});
        }
    },

    security: (message: string, meta?: unknown) => {
        emit('SECURITY', message, meta);
    },

    debug: (message: string, meta?: unknown) => {
        if (process.env.NODE_ENV === 'development') {
            emit('DEBUG', message, meta);
        }
    },
};
