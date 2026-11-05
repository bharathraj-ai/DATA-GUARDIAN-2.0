/**
 * Regression tests for Editor Replay-Protection Headers & secureFetch helper.
 */

import { withSecurityHeaders, secureFetch } from '@/lib/security/secure-fetch';

describe('Editor Replay-Protection: withSecurityHeaders and secureFetch', () => {
    const originalFetch = global.fetch;

    afterEach(() => {
        global.fetch = originalFetch;
    });

    it('withSecurityHeaders attaches x-security-nonce and x-timestamp', () => {
        const init = withSecurityHeaders();
        const headers = init.headers as Headers;

        expect(headers).toBeDefined();
        const nonce = headers.get('x-security-nonce');
        const timestamp = headers.get('x-timestamp');

        expect(nonce).toBeDefined();
        // Nonce must be a valid UUID
        expect(nonce).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);

        expect(timestamp).toBeDefined();
        const ts = Number(timestamp);
        expect(Number.isFinite(ts)).toBe(true);
        expect(Math.abs(Date.now() - ts)).toBeLessThan(2000);
    });

    it('withSecurityHeaders preserves caller-supplied custom headers and body', () => {
        const customHeaders = {
            'Content-Type': 'application/json',
            'x-edit-client-instance': 'tab-instance-1234',
        };

        const init = withSecurityHeaders({
            method: 'POST',
            headers: customHeaders,
            body: JSON.stringify({ token: 'test-token' }),
        });

        const headers = init.headers as Headers;
        expect(headers.get('content-type')).toBe('application/json');
        expect(headers.get('x-edit-client-instance')).toBe('tab-instance-1234');
        expect(headers.get('x-security-nonce')).toBeTruthy();
        expect(headers.get('x-timestamp')).toBeTruthy();
        expect(init.method).toBe('POST');
        expect(init.body).toBe(JSON.stringify({ token: 'test-token' }));
    });

    it('successive calls generate distinct nonces to prevent replay collisions', () => {
        const init1 = withSecurityHeaders();
        const init2 = withSecurityHeaders();

        const headers1 = init1.headers as Headers;
        const headers2 = init2.headers as Headers;

        const nonce1 = headers1.get('x-security-nonce');
        const nonce2 = headers2.get('x-security-nonce');

        expect(nonce1).not.toBe(nonce2);
    });

    it('secureFetch forwards security headers to underlying fetch call', async () => {
        const mockFetch = jest.fn().mockResolvedValue(new Response(JSON.stringify({ success: true })));
        global.fetch = mockFetch;

        const url = '/api/documents/test-doc-id/raw?token=abc';
        await secureFetch(url, { credentials: 'include', cache: 'no-store' });

        expect(mockFetch).toHaveBeenCalledTimes(1);
        const [calledUrl, calledInit] = mockFetch.mock.calls[0];

        expect(calledUrl).toBe(url);
        expect(calledInit.credentials).toBe('include');
        expect(calledInit.cache).toBe('no-store');

        const headers = calledInit.headers as Headers;
        expect(headers.get('x-security-nonce')).toMatch(/^[0-9a-f-]{36}$/i);
        const ts = Number(headers.get('x-timestamp'));
        expect(Math.abs(Date.now() - ts)).toBeLessThan(2000);
    });
});

