import crypto from 'crypto';

export interface CspOptions {
    isDev?: boolean;
    pathname?: string;
    onlyOfficeServerUrl?: string;
}

/**
 * Generate a cryptographically secure, unpredictable base64 nonce.
 */
export function generateCspNonce(): string {
    return crypto.randomBytes(16).toString('base64');
}

/**
 * Builds a strict, Next.js 16-compatible Content Security Policy header.
 * 
 * Security features:
 * - Removes 'unsafe-inline' from production script-src.
 * - Uses dynamic 'nonce-{nonce}' and 'strict-dynamic' for script execution.
 * - Allows 'unsafe-eval' ONLY in development mode (required by React/Next.js HMR).
 * - Preserves Google OAuth (accounts.google.com) and Google/GitHub avatar images.
 * - Allows ONLYOFFICE iframe integration for document editing.
 * - Restricts frame-ancestors to 'none' (anti-clickjacking).
 * - Restricts object-src to 'none' and base-uri to 'self'.
 */
export function buildCspHeader(nonce: string, options: CspOptions = {}): string {
    const isDev = options.isDev ?? (process.env.NODE_ENV === 'development');
    const pathname = options.pathname || '';
    const isEditor = pathname.startsWith('/editor');
    const onlyOfficeUrl = options.onlyOfficeServerUrl || process.env.ONLYOFFICE_SERVER_URL || 'http://localhost:8080';

    // 1. Script sources
    // Production: NO 'unsafe-inline'. Uses nonce + strict-dynamic.
    // Development: includes 'unsafe-eval' for React devtools / error stack traces.
    const scriptSrcDirectives = [
        "'self'",
        `'nonce-${nonce}'`,
        "'strict-dynamic'",
        "https://accounts.google.com",
        isDev ? "'unsafe-eval'" : null,
        isEditor && onlyOfficeUrl ? onlyOfficeUrl : null,
    ].filter(Boolean).join(' ');

    // 2. Style sources: 'self', 'unsafe-inline' (for Next.js CSS Modules & inline style attributes), and Google Fonts
    const styleSrcDirectives = [
        "'self'",
        "'unsafe-inline'",
        "https://fonts.googleapis.com",
    ].join(' ');

    // 3. Image sources: self, data:, blob:, and trusted OAuth provider avatars
    const imgSrcDirectives = [
        "'self'",
        "data:",
        "blob:",
        "https://lh3.googleusercontent.com",
        "https://avatars.githubusercontent.com",
    ].join(' ');

    // 4. Font sources: self and Google Fonts
    const fontSrcDirectives = [
        "'self'",
        "https://fonts.gstatic.com",
        "data:",
    ].join(' ');

    // 5. Connect sources: self, Upstash Redis, Neon DB, and Google OAuth
    const connectSrcDirectives = [
        "'self'",
        "https://*.upstash.io",
        "https://*.neon.tech",
        "https://accounts.google.com",
        isEditor && onlyOfficeUrl ? onlyOfficeUrl : null,
    ].filter(Boolean).join(' ');

    // 6. Frame sources: PDF previews (blob:, data:), Google OAuth, ONLYOFFICE
    const frameSrcDirectives = [
        "'self'",
        "blob:",
        "data:",
        "https://accounts.google.com",
        onlyOfficeUrl,
    ].filter(Boolean).join(' ');

    // 7. Assemble all directives
    const directives: string[] = [
        "default-src 'self'",
        `script-src ${scriptSrcDirectives}`,
        `style-src ${styleSrcDirectives}`,
        `img-src ${imgSrcDirectives}`,
        `font-src ${fontSrcDirectives}`,
        `connect-src ${connectSrcDirectives}`,
        `frame-src ${frameSrcDirectives}`,
        "frame-ancestors 'none'",
        "base-uri 'self'",
        "form-action 'self' https://accounts.google.com",
        "object-src 'none'",
        !isDev ? "upgrade-insecure-requests" : null,
    ].filter((d): d is string => Boolean(d));

    return directives.join('; ');
}

