/**
 * Resolves the absolute base URL from the request headers, supporting reverse proxies (Vercel, Railway, Nginx).
 * Safely handles proxy headers to prevent internal localhost leaks in production.
 * 
 * @param {import('http').IncomingMessage} req - The standard Node.js/Next.js request object
 * @returns {string} The fully qualified base URL (e.g., "https://myapp.com")
 */
export const getBaseUrl = (req) => {
    const headers = req.headers;

    // 1. Resolve Protocol: Trust x-forwarded-proto, handle multi-value headers, default to https
    let protocol = headers['x-forwarded-proto'];
    if (Array.isArray(protocol)) protocol = protocol[0];
    if (typeof protocol === 'string' && protocol.includes(',')) protocol = protocol.split(',')[0].trim();
    protocol = protocol || 'https';

    // 2. Resolve Host: Trust x-forwarded-host, fallback to Host header
    let host = headers['x-forwarded-host'] || headers.host;
    if (Array.isArray(host)) host = host[0];
    if (typeof host === 'string' && host.includes(',')) host = host.split(',')[0].trim();

    return `${protocol}://${host}`;
};
