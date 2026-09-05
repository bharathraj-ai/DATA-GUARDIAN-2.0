/**
 * Boot-time secret checks. Production refuses to start when crypto keys are
 * missing, reused, or Redis is unset. Development logs warnings only.
 * Skipped during `next build` and Jest so CI/generate still work.
 */

const HEX_64 = /^[0-9a-fA-F]{64}$/;

export function isProductionRuntime(): boolean {
    if (process.env.NODE_ENV === 'test') return false;
    if (process.env.NEXT_PHASE === 'phase-production-build') return false;
    return process.env.NODE_ENV === 'production';
}

function present(value: string | undefined): string | undefined {
    const trimmed = value?.trim();
    return trimmed ? trimmed : undefined;
}

function distinct(labelA: string, a: string | undefined, labelB: string, b: string | undefined): string | null {
    if (a && b && a === b) {
        return `${labelA} must not equal ${labelB}`;
    }
    return null;
}

export function collectSecretIssues(options?: { strict?: boolean }): string[] {
    const strict = options?.strict ?? isProductionRuntime();
    const issues: string[] = [];

    const encryptionKey = present(process.env.ENCRYPTION_KEY);
    const kekKey = present(process.env.KEK_KEY);
    const otpHmac = present(process.env.OTP_HMAC_SECRET);
    const sessionHmac = present(process.env.SESSION_HMAC_SECRET);
    const auditHmac = present(process.env.AUDIT_HMAC_SECRET);
    const nextAuthSecret = present(process.env.NEXTAUTH_SECRET);
    const cronSecret = present(process.env.CRON_SECRET);
    const redisUrl = present(process.env.UPSTASH_REDIS_REST_URL);
    const redisToken = present(process.env.UPSTASH_REDIS_REST_TOKEN);

    if (strict) {
        if (!encryptionKey) issues.push('ENCRYPTION_KEY is required');
        else if (!HEX_64.test(encryptionKey)) issues.push('ENCRYPTION_KEY must be 64 hex characters');

        if (!kekKey) issues.push('KEK_KEY is required');
        else if (!HEX_64.test(kekKey)) issues.push('KEK_KEY must be 64 hex characters');

        if (!otpHmac) issues.push('OTP_HMAC_SECRET is required (do not fall back to ENCRYPTION_KEY)');
        else if (otpHmac.length < 32) issues.push('OTP_HMAC_SECRET must be at least 32 characters');

        if (!sessionHmac) issues.push('SESSION_HMAC_SECRET is required (do not fall back to ENCRYPTION_KEY)');
        else if (sessionHmac.length < 32) issues.push('SESSION_HMAC_SECRET must be at least 32 characters');

        if (!auditHmac) issues.push('AUDIT_HMAC_SECRET is required (do not fall back to SESSION_HMAC_SECRET)');
        else if (auditHmac.length < 32) issues.push('AUDIT_HMAC_SECRET must be at least 32 characters');

        if (!nextAuthSecret) issues.push('NEXTAUTH_SECRET is required');
        else if (nextAuthSecret.length < 32) issues.push('NEXTAUTH_SECRET must be at least 32 characters');

        if (!cronSecret) issues.push('CRON_SECRET is required');
        else if (cronSecret.length < 32) issues.push('CRON_SECRET must be at least 32 characters');

        if (!redisUrl || redisUrl.includes('your-redis')) {
            issues.push('UPSTASH_REDIS_REST_URL is required in production');
        }
        if (!redisToken) issues.push('UPSTASH_REDIS_REST_TOKEN is required in production');
    } else {
        if (encryptionKey && !HEX_64.test(encryptionKey)) {
            issues.push('ENCRYPTION_KEY must be 64 hex characters');
        }
        if (kekKey && !HEX_64.test(kekKey)) {
            issues.push('KEK_KEY must be 64 hex characters');
        }
    }

    const eq = [
        distinct('KEK_KEY', kekKey, 'ENCRYPTION_KEY', encryptionKey),
        distinct('OTP_HMAC_SECRET', otpHmac, 'ENCRYPTION_KEY', encryptionKey),
        distinct('OTP_HMAC_SECRET', otpHmac, 'KEK_KEY', kekKey),
        distinct('SESSION_HMAC_SECRET', sessionHmac, 'ENCRYPTION_KEY', encryptionKey),
        distinct('SESSION_HMAC_SECRET', sessionHmac, 'KEK_KEY', kekKey),
        distinct('SESSION_HMAC_SECRET', sessionHmac, 'OTP_HMAC_SECRET', otpHmac),
        distinct('AUDIT_HMAC_SECRET', auditHmac, 'SESSION_HMAC_SECRET', sessionHmac),
        distinct('AUDIT_HMAC_SECRET', auditHmac, 'OTP_HMAC_SECRET', otpHmac),
        distinct('AUDIT_HMAC_SECRET', auditHmac, 'NEXTAUTH_SECRET', nextAuthSecret),
        distinct('NEXTAUTH_SECRET', nextAuthSecret, 'ENCRYPTION_KEY', encryptionKey),
        distinct('NEXTAUTH_SECRET', nextAuthSecret, 'SESSION_HMAC_SECRET', sessionHmac),
    ];
    for (const issue of eq) {
        if (issue) issues.push(issue);
    }

    return issues;
}

export function assertRuntimeSecrets(): void {
    const issues = collectSecretIssues();
    if (issues.length === 0) return;

    const message = `Invalid runtime secrets: ${issues.join('; ')}`;
    if (isProductionRuntime()) {
        throw new Error(message);
    }

    // Lazy import so Edge/build graphs that only type-check this module stay light.
    void import('@/lib/logger').then(({ logger }) => {
        logger.warn('[env] ' + message);
    }).catch(() => {
        console.warn('[env]', message);
    });
}
