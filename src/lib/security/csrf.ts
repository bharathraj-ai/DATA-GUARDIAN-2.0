import { NextRequest } from 'next/server';
import { extractHostFromOrigin, isAllowedHost } from './origin-validator';
import { logger } from '@/lib/logger';

/**
 * Get the set of trusted hosts for this environment.
 */
export function getAllowedHosts(requestHost: string | null): Set<string> {
  const allowed = new Set<string>();

  // 1. Always allow the host the request was sent to (same-origin policy)
  if (requestHost) {
    allowed.add(requestHost);
  }

  // 2. Allow configured NEXTAUTH_URL / APP_URL
  const appUrl = process.env.NEXTAUTH_URL || process.env.APP_URL;
  if (appUrl) {
    try {
      allowed.add(new URL(appUrl).host);
    } catch {
      // Ignore invalid URL in env
    }
  }

  // 3. Vercel deployment URLs (if applicable)
  const vercelUrl = process.env.VERCEL_URL;
  if (vercelUrl) {
    allowed.add(vercelUrl);
  }

  return allowed;
}

export type CSRFValidationResult = 
  | { allowed: true }
  | { allowed: false; reason: string; status: number };

export interface CSRFValidationInput {
  method: string;
  url?: string;
  headers: Headers | ReadonlyMap<string, string> | { get: (name: string) => string | null | undefined };
}

/**
 * Centralized CSRF validation logic for all API routes.
 * Enforces Origin/Host matching on state-changing methods.
 */
export function validateCSRF(requestOrInput: NextRequest | Request | CSRFValidationInput): CSRFValidationResult {
  const method = requestOrInput.method.toUpperCase();
  const headers = 'headers' in requestOrInput ? requestOrInput.headers : requestOrInput;
  const url = 'url' in requestOrInput ? requestOrInput.url : undefined;
  
  const getHeader = (name: string): string | null => {
    if (typeof headers.get === 'function') {
      const val = headers.get(name);
      return val ? String(val) : null;
    }
    return null;
  };
  const isMutating = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method);

  // GET/HEAD/OPTIONS are safe methods (assuming no state-changing GETs exist)
  if (!isMutating) {
    return { allowed: true };
  }

  const origin = getHeader('origin');
  const host = getHeader('host');
  const referer = getHeader('referer');

  const allowedHosts = getAllowedHosts(host);

  // Standard Origin check
  if (origin) {
    const originHost = extractHostFromOrigin(origin);
    if (!originHost) {
      return { allowed: false, reason: 'CSRF Violation: Invalid Origin format', status: 403 };
    }
    
    if (isAllowedHost(originHost, allowedHosts)) {
      return { allowed: true };
    } else {
      logger.security('Blocked: Origin mismatch', { origin: originHost, host, allowed: Array.from(allowedHosts) });
      return { allowed: false, reason: 'CSRF Violation: Origin mismatch', status: 403 };
    }
  }

  // Fallback to Referer check if Origin is absent (some older browsers/proxies drop Origin)
  if (referer) {
    const refererHost = extractHostFromOrigin(referer); // works same for referer URL
    if (!refererHost) {
      return { allowed: false, reason: 'CSRF Violation: Invalid Referer format', status: 403 };
    }

    if (isAllowedHost(refererHost, allowedHosts)) {
      return { allowed: true };
    } else {
      logger.security('Blocked: Referer mismatch', { referer: refererHost, host, allowed: Array.from(allowedHosts) });
      return { allowed: false, reason: 'CSRF Violation: Referer mismatch', status: 403 };
    }
  }

  // Fail-closed if both Origin and Referer are missing on a mutating request
  logger.security('Blocked: Missing Origin and Referer headers on mutating request', { method, url });
  return { allowed: false, reason: 'CSRF Violation: Missing Origin/Referer headers', status: 403 };
}
