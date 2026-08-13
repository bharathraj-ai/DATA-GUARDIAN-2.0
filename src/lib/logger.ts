/**
 * Centralized logging utility for Data Guardian.
 * Implements production-safe logging standards and sensitive data redaction
 * in compliance with OWASP Logging Cheat Sheet (A09:2021).
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
    
    return '***.***.***.***';
}

/**
 * Redacts a token (e.g., a uuid or secure link token)
 * Shows only the first 4 characters.
 */
export function redactToken(token: string | null | undefined): string {
    if (!token) return 'unknown';
    return token.substring(0, 4) + '***';
}

/**
 * Redacts a session ID, showing only the first 6 characters.
 */
export function redactSessionId(sessionId: string | null | undefined): string {
    if (!sessionId) return 'unknown';
    return sessionId.substring(0, 6) + '***';
}

// ============================================
// LOGGER IMPL
// ============================================

const formatMessage = (level: string, message: string, meta?: any) => {
    const timestamp = new Date().toISOString();
    const requestId = typeof meta?.requestId === 'string' ? meta.requestId : undefined;
    const rest = meta && typeof meta === 'object' ? { ...meta } : meta;
    if (rest && typeof rest === 'object' && 'requestId' in rest) {
        delete (rest as { requestId?: string }).requestId;
    }
    let out = `[${timestamp}] [${level}]${requestId ? ` [${requestId}]` : ''} ${message}`;
    if (rest && !(typeof rest === 'object' && Object.keys(rest).length === 0)) {
        try {
            out += ` | ${JSON.stringify(rest)}`;
        } catch {
            out += ` | [Unserializable Metadata]`;
        }
    }
    return out;
};

export const logger = {
    /**
     * General business events and operational flow.
     */
    info: (message: string, meta?: any) => {
        console.log(formatMessage('INFO', message, meta));
    },
    
    /**
     * Suspicious activity, potential attacks, CSRF blocks, rate limits.
     */
    warn: (message: string, meta?: any) => {
        console.warn(formatMessage('WARN', message, meta));
    },
    
    /**
     * Critical failures, unhandled exceptions, database connection drops.
     */
    error: (message: string, error?: any, meta?: any) => {
        const errMsg = error instanceof Error ? error.message : error;
        console.error(formatMessage('ERROR', message, { error: errMsg, ...meta }));
    },
    
    /**
     * Security specific events (e.g., replay attacks, BOLA attempts).
     */
    security: (message: string, meta?: any) => {
        // We log security events as WARN in production so they stand out in typical console streams
        console.warn(formatMessage('SECURITY', message, meta));
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
