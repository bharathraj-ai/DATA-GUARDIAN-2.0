import { ResponseCookie } from 'next/dist/compiled/@edge-runtime/cookies';

const isProduction = process.env.NODE_ENV === 'production';

/**
 * Canonical secure configuration for session cookies.
 * Adheres to OWASP best practices.
 */
export const SESSION_COOKIE_OPTIONS: Partial<ResponseCookie> = {
  httpOnly: true,
  secure: isProduction,
  // SameSite=Lax is REQUIRED for NextAuth OAuth redirects to function.
  // Cross-origin POSTs will not include this cookie, providing CSRF defense-in-depth.
  sameSite: 'lax',
  path: '/',
};

/**
 * Helper to create cookie options with an enforced secure baseline.
 */
export function createSecureCookieOptions(
  overrides?: Partial<ResponseCookie>
): Partial<ResponseCookie> {
  return {
    ...SESSION_COOKIE_OPTIONS,
    ...overrides,
  };
}
