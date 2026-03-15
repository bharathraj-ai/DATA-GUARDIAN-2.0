import jwt from 'jsonwebtoken';

/**
 * ONLYOFFICE JWT Utilities
 *
 * All communication between our backend and the ONLYOFFICE Document Server
 * is signed with JWT to prevent unauthorized access and request tampering.
 *
 * The JWT secret MUST match the one configured in ONLYOFFICE Docker env:
 *   JWT_SECRET=${ONLYOFFICE_JWT_SECRET}
 */

function getJwtSecret(): string {
  const secret = process.env.ONLYOFFICE_JWT_SECRET;
  if (!secret) {
    throw new Error(
      'ONLYOFFICE_JWT_SECRET is not set. ' +
      'Add it to .env and ensure ONLYOFFICE Docker uses the same secret.'
    );
  }
  return secret;
}

/**
 * Sign a payload for ONLYOFFICE.
 * Used when building editor configurations — the token is embedded in the
 * config JSON so ONLYOFFICE can verify the request came from our server.
 */
export function signOnlyOfficeToken(payload: Record<string, unknown>): string {
  return jwt.sign(payload, getJwtSecret(), {
    algorithm: 'HS256',
    expiresIn: '1h', // Tokens expire after 1 hour
  });
}

/**
 * Verify a JWT sent by ONLYOFFICE (e.g. in callback requests).
 * Returns the decoded payload or throws on invalid/expired tokens.
 */
export function verifyOnlyOfficeToken(token: string): Record<string, unknown> {
  const decoded = jwt.verify(token, getJwtSecret(), {
    algorithms: ['HS256'],
  });

  if (typeof decoded === 'string') {
    throw new Error('Unexpected JWT string payload');
  }

  return decoded as Record<string, unknown>;
}

/**
 * Extract JWT from Authorization header.
 * ONLYOFFICE sends: Authorization: Bearer <token>
 */
export function extractBearerToken(
  authHeader: string | null
): string | null {
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return null;
  }
  return authHeader.slice(7);
}
