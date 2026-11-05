/**
 * Regression test suite for Next.js middleware execution, CSRF, and CSP protection.
 */

import { NextRequest } from 'next/server';
import { middleware, config } from '@/middleware';

describe('Next.js Middleware Execution & Security Headers', () => {
  it('middleware exports required handlers and matcher configuration', () => {
    expect(typeof middleware).toBe('function');
    expect(config).toBeDefined();
    expect(config.matcher).toBeDefined();
    expect(Array.isArray(config.matcher)).toBe(true);
  });

  it('injects x-request-id, x-nonce, and Content-Security-Policy headers on GET requests', () => {
    const req = new NextRequest('http://localhost:3000/dashboard/owner', {
      method: 'GET',
    });

    const res = middleware(req);
    expect(res.headers.get('x-request-id')).toBeTruthy();
    expect(res.headers.get('x-nonce')).toBeTruthy();
    const csp = res.headers.get('Content-Security-Policy');
    expect(csp).toBeTruthy();
    expect(csp).toContain('default-src');
  });

  it('rejects cross-origin mutating API requests lacking valid Origin/Referer (CSRF block)', () => {
    const req = new NextRequest('http://localhost:3000/api/documents/test-file/save', {
      method: 'POST',
      headers: {
        origin: 'https://evil-attacker-site.com',
        host: 'localhost:3000',
      },
    });

    const res = middleware(req);
    expect(res.status).toBe(403);
    expect(res.headers.get('x-request-id')).toBeTruthy();
    expect(res.headers.get('Content-Security-Policy')).toBeTruthy();
  });

  it('allows same-origin mutating API requests', () => {
    const req = new NextRequest('http://localhost:3000/api/documents/test-file/save', {
      method: 'POST',
      headers: {
        origin: 'http://localhost:3000',
        host: 'localhost:3000',
      },
    });

    const res = middleware(req);
    // 200 / Next middleware pass-through
    expect(res.status).toBe(200);
    expect(res.headers.get('x-request-id')).toBeTruthy();
  });

  it('does not block NextAuth API mutating endpoints via CSRF middleware (NextAuth handles its own)', () => {
    const req = new NextRequest('http://localhost:3000/api/auth/callback/credentials', {
      method: 'POST',
      headers: {
        origin: 'http://localhost:3000',
      },
    });

    const res = middleware(req);
    expect(res.status).toBe(200);
  });
});

