/**
 * Centralized secure logging utility for Data Guardian.
 * Implements production-safe logging standards and sensitive data redaction
 * in compliance with OWASP Logging Cheat Sheet (A09:2021) and SV-08.
 */

// ============================================
// REDACTION HELPERS
// ============================================

/**
 * Redacts an email address (e.g., john.doe@example.com -> j***@example.com)
 */
export function redactEmail(email: string | null | undefined): string {
    if (!email) return 'unknown';
    const parts = email.split('@');
    if (parts.length !== 2) return '***'; // Invalid format, redact entirely
    const [local, domain] = parts;
    if (local.length <= 1) return `*@${domain}`;
    return `${local.charAt(0)}***@${domain}`;
}

/**
 * Redacts an IP address (e.g., 192.168.1.100 -> 192.168.xxx.xxx)
 */
export function redactIp(ip: string | null | undefined): string {
    if (!ip) return 'unknown';
    
    // IPv4
    if (ip.includes('.')) {
        const parts = ip.split('.');
        if (parts.length === 4) {
            return `${parts[0]}.${parts[1]}.xxx.xxx`;
        }
    }
    
    // IPv6
    if (ip.includes(':')) {
        const parts = ip.split(':');
        if (parts.length > 2) {
            return `${parts[0]}:${parts[1]}:xxxx:xxxx:xxxx:xxxx:xxxx:xxxx`;
        }
    }
    
    return '***.***.***.xxx';
}

/**
 * Redacts a token (e.g., a uuid or secure link token)
 * Shows only the first 4 characters.
 */
export function redactToken(token: string | null | undefined): string {
    if (!token) return 'unknown';
    if (token.length <= 4) return '***';
    return token.substring(0, 4) + '***';
}

/**
 * Redacts a session ID, showing only the first 6 characters.
 */
export function redactSessionId(sessionId: string | null | undefined): string {
    if (!sessionId) return 'unknown';
    if (sessionId.length <= 6) return '***';
    return sessionId.substring(0, 6) + '***';
}

// ============================================
// COMPREHENSIVE SENSITIVE DATA REDACTION (SV-08)
// ============================================

const SENSITIVE_KEY_PATTERNS = [
    /password/i,
    /passwd/i,
    /secret/i,
    /otp/i,
    /(?:otp|verification|auth|pass|pin|security)_?code/i,
    /\bpasscode\b/i,
    /\bpin\b/i,
    /(?:encryption|raw|secret|master|api|private|public|session)_?key|key\b/i,
    /\bdek\b/i,
    /token/i,
    /session.?id/i,
    /cookie/i,
    /authorization/i,
    /auth.?tag/i,
    /encrypted.?content/i,
    /file.?content/i,
    /\bbuffer\b/i,
    /data.?uri/i,
    /email/i,
];

// Connection strings: postgres://user:password@host, mongodb+srv://user:password@host, etc.
// Uses ([^/\s]+)@ so passwords containing special characters (including @) up to the host delimiter are matched.
const DB_CONN_STRING_REGEX = /(postgres(?:ql)?|mongodb(?:\+srv)?|redis[s]?|mysql):\/\/([^:\s/]+):([^/\s]+)@/gi;
// Bearer tokens
const BEARER_TOKEN_REGEX = /Bearer\s+([A-Za-z0-9\-_=.]+)/gi;
// Session cookies
const SESSION_COOKIE_REGEX = /session_id=([^;\s]+)/gi;

/**
 * Sanitize string messages against known secret values and patterns.
 */
export function sanitizeLogString(str: string): string {
    if (!str || typeof str !== 'string') return '';

    let sanitized = str;

    // 1. Redact literal environment secrets if they appear in logs or stack traces
    const knownSecrets = [
        process.env.ENCRYPTION_KEY,
        process.env.KEK_KEY,
        process.env.OTP_HMAC_SECRET,
        process.env.SESSION_HMAC_SECRET,
        process.env.NEXTAUTH_SECRET,
        process.env.UPSTASH_REDIS_REST_TOKEN,
        process.env.CRON_SECRET,
        process.env.EMAIL_PASS,
        process.env.GOOGLE_CLIENT_SECRET,
        process.env.DATABASE_URL,
        process.env.DIRECT_URL,
        process.env.MONGODB_URI,
    ].filter((s): s is string => typeof s === 'string' && s.length >= 8);

    for (const secret of knownSecrets) {
        sanitized = sanitized.split(secret).join('[REDACTED_SECRET]');
    }

    // 2. Redact passwords in connection URLs
    sanitized = sanitized.replace(DB_CONN_STRING_REGEX, '$1://$2:[REDACTED_PASSWORD]@');

    // 3. Redact Bearer tokens
    sanitized = sanitized.replace(BEARER_TOKEN_REGEX, 'Bearer [REDACTED_TOKEN]');

    // 4. Redact session_id in cookie strings
    sanitized = sanitized.replace(SESSION_COOKIE_REGEX, 'session_id=[REDACTED_SESSION]');

    return sanitized;
}

/**
 * Recursively deep-redacts sensitive object keys, Buffers, and exceptions.
 */
export function redactSensitiveData(data: unknown, depth = 0, seen = new WeakSet()): unknown {
    if (data === null || data === undefined) return data;
    if (depth > 8) return '[Max Depth Reached]';

    // Buffers / binary contents
    if (typeof Buffer !== 'undefined' && Buffer.isBuffer(data)) {
        return `[Buffer ${data.length} bytes]`;
    }

    // Uint8Array or ArrayBuffer
    if (data instanceof Uint8Array || data instanceof ArrayBuffer) {
        return `[Binary Data ${(data as Uint8Array).byteLength || 0} bytes]`;
    }

    // Error instances
    if (data instanceof Error) {
        return {
            name: data.name,
            message: sanitizeLogString(data.message),
            code: (data as { code?: unknown }).code,
            stack: data.stack ? sanitizeLogString(data.stack) : undefined,
        };
    }

    // Strings
    if (typeof data === 'string') {
        return sanitizeLogString(data);
    }

    // Numbers, booleans, symbols, functions
    if (typeof data !== 'object') {
        return data;
    }

    // Avoid circular structure crashes
    if (seen.has(data)) {
        return '[Circular]';
    }
    seen.add(data);

    // Arrays
    if (Array.isArray(data)) {
        return data.map((item) => redactSensitiveData(item, depth + 1, seen));
    }

    // Plain objects
    const redactedObj: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(data)) {
        const isSensitiveKey = SENSITIVE_KEY_PATTERNS.some((pattern) => pattern.test(key));

        if (isSensitiveKey) {
            if (/email/i.test(key) && typeof val === 'string') {
                redactedObj[key] = redactEmail(val);
            } else if (/password/i.test(key)) {
                redactedObj[key] = '[REDACTED_PASSWORD]';
            } else if (/otp|passcode|pin|(?:otp|verification|auth|pass|pin|security)_?code/i.test(key)) {
                redactedObj[key] = '[REDACTED_OTP]';
            } else if (/key|dek/i.test(key)) {
                redactedObj[key] = '[REDACTED_KEY]';
            } else if (/content|buffer|raw/i.test(key)) {
                redactedObj[key] = '[REDACTED_CONTENT]';
            } else if (/token|session/i.test(key) && typeof val === 'string') {
                redactedObj[key] = redactToken(val);
            } else {
                redactedObj[key] = '[REDACTED]';
            }
        } else {
            redactedObj[key] = redactSensitiveData(val, depth + 1, seen);
        }
    }

    return redactedObj;
}

// ============================================
// LOGGER IMPLEMENTATION
// ============================================

const formatMessage = (level: string, message: string, meta?: any) => {
    const timestamp = new Date().toISOString();
    const sanitizedMsg = sanitizeLogString(message);
    const requestId = typeof meta?.requestId === 'string' ? meta.requestId : undefined;

    let rest = meta;
    if (rest && typeof rest === 'object') {
        rest = { ...rest };
        delete rest.requestId;
    }

    const safeRest = rest !== undefined ? redactSensitiveData(rest) : undefined;

    let out = `[${timestamp}] [${level}]${requestId ? ` [${requestId}]` : ''} ${sanitizedMsg}`;
    if (safeRest !== undefined && !(typeof safeRest === 'object' && safeRest !== null && Object.keys(safeRest).length === 0)) {
        try {
            out += ` | ${JSON.stringify(safeRest)}`;
        } catch {
            out += ` | [Unserializable Metadata]`;
        }
    }
    return out;
};

export const logger = {
    /**
     * General business events and operational flow.
     * Direct stdout write ensures logs reach telemetry even if SWC removes console.log.
     */
    info: (message: string, meta?: any) => {
        const formatted = formatMessage('INFO', message, meta);
        if (typeof process !== 'undefined' && process.stdout?.write) {
            process.stdout.write(formatted + '\n');
        } else {
            console.info(formatted);
        }
    },
    
    /**
     * Suspicious activity, potential attacks, CSRF blocks, rate limits.
     */
    warn: (message: string, meta?: any) => {
        console.warn(formatMessage('WARN', message, meta));
    },
    
    /**
     * Critical failures, unhandled exceptions, database connection drops.
     * Sanitizes error message, stack trace, and metadata against secret leaks.
     */
    error: (message: string, error?: any, meta?: any) => {
        let errPayload: any;
        if (error instanceof Error) {
            errPayload = {
                message: sanitizeLogString(error.message),
                name: error.name,
                code: (error as { code?: unknown }).code,
                stack: error.stack ? sanitizeLogString(error.stack) : undefined,
            };
        } else if (error !== undefined) {
            errPayload = redactSensitiveData(error);
        }

        const combinedMeta = {
            ...(errPayload !== undefined ? { error: errPayload } : {}),
            ...(meta && typeof meta === 'object' ? meta : meta !== undefined ? { meta } : {}),
        };

        console.error(formatMessage('ERROR', message, combinedMeta));
    },
    
    /**
     * Security specific events (e.g., replay attacks, BOLA attempts, authentication failures).
     */
    security: (message: string, meta?: any) => {
        console.warn(formatMessage('SECURITY', message, meta));
    },

    /**
     * Structured security event logging (SV-08).
     * Emits standardized audit-ready security telemetry with event type and details.
     */
    securityEvent: (eventType: string, details: Record<string, unknown> = {}) => {
        const payload = {
            event: eventType,
            ...details,
        };
        console.warn(formatMessage('SECURITY', `[${eventType}]`, payload));
    },
    
    /**
     * Development and debugging logs. Only printed when NODE_ENV is development.
     * NEVER use this for secrets in production, but it safely ignores them in prod.
     */
    debug: (message: string, meta?: any) => {
        if (process.env.NODE_ENV === 'development') {
            console.log(formatMessage('DEBUG', message, meta));
        }
    }
};
