import { NextRequest } from 'next/server';

/**
 * Safely extract the host from an Origin header string.
 */
export function extractHostFromOrigin(origin: string | null): string | null {
  if (!origin) return null;
  try {
    return new URL(origin).host;
  } catch {
    return null;
  }
}

/**
 * Checks if a given host is in the list of allowed hosts.
 */
export function isAllowedHost(host: string | null, allowedHosts: Set<string>): boolean {
  if (!host) return false;
  
  // Direct match using the Set for O(1) lookup
  if (allowedHosts.has(host)) return true;

  return false;
}
