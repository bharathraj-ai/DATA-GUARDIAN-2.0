/**
 * Regression test suite for JWT session invalidation after password reset.
 */

import { authOptions } from '@/lib/auth';
import {
  revokeAllUserSessions,
  isUserSessionRevoked,
  _clearUserSessionRevocationsForTesting,
} from '@/lib/security/user-session-revocation';
import type { JWT } from 'next-auth/jwt';
import type { Session } from 'next-auth';

describe('JWT Session Invalidation After Password Reset', () => {
  beforeEach(() => {
    _clearUserSessionRevocationsForTesting();
  });

  it('marks older JWT tokens as revoked after revokeAllUserSessions is called', async () => {
    const userId = 'user-test-123';
    const oldTokenTime = Math.floor(Date.now() / 1000) - 60; // 60s ago

    // Prior to revocation, session is valid
    const isRevokedBefore = await isUserSessionRevoked(userId, oldTokenTime);
    expect(isRevokedBefore).toBe(false);

    // Revoke all sessions (e.g. password was reset)
    await revokeAllUserSessions(userId);

    // Old token must now be reported as revoked
    const isRevokedAfter = await isUserSessionRevoked(userId, oldTokenTime);
    expect(isRevokedAfter).toBe(true);

    // A fresh token issued after revocation must be valid
    const newTokenTime = Math.floor(Date.now() / 1000) + 1;
    const isNewRevoked = await isUserSessionRevoked(userId, newTokenTime);
    expect(isNewRevoked).toBe(false);
  });

  it('authOptions.callbacks.jwt sets isRevoked: true on stale tokens', async () => {
    const jwtCallback = authOptions.callbacks?.jwt;
    expect(jwtCallback).toBeDefined();

    const userId = 'user-jwt-456';
    const oldAuthTime = Math.floor(Date.now() / 1000) - 100;

    await revokeAllUserSessions(userId);

    const token: JWT = {
      id: userId,
      authTime: oldAuthTime,
      role: 'VENDOR',
    };

    const result = await jwtCallback!({ token, user: undefined as any, account: null });
    expect(result.isRevoked).toBe(true);
  });

  it('authOptions.callbacks.session clears session when token is revoked', async () => {
    const sessionCallback = authOptions.callbacks?.session;
    expect(sessionCallback).toBeDefined();

    const revokedToken: JWT = {
      id: 'user-jwt-789',
      isRevoked: true,
    };

    const emptySession: Session = {
      user: {
        id: 'user-jwt-789',
        name: 'Test',
        email: 'test@example.com',
        role: 'VENDOR',
        roleSelected: true,
        onboardingStep: 'COMPLETE',
      },
      expires: new Date(Date.now() + 3600000).toISOString(),
    };

    const sessionResult = await sessionCallback!({
      session: emptySession,
      token: revokedToken,
      user: undefined as any,
      newSession: undefined,
      trigger: undefined as any,
    });

    // Revoked token must yield an empty/invalid session object with no user
    expect(sessionResult.user).toBeUndefined();
  });
});
