/**
 * Cryptographic secret validation — runs at application startup.
 *
 * Validates:
 * - Presence of required cryptographic secrets
 * - Minimum length and character format (AES keys must be 64 valid hex characters)
 * - Secret strength (rejects trivial / repeated-pattern weak keys)
 * - Uniqueness (strictly rejects duplicate secrets across different cryptographic roles)
 *
 * IMPORTANT: This file must NOT import heavy modules (Prisma, Redis, etc.)
 * to avoid circular-dependency crashes during module initialisation.
 */

export type SecretSpec = {
  name: string;
  envVar: string;
  required: boolean;
  minLength: number;
  pattern?: RegExp;
  patternDescription?: string;
};

export const SECRET_SPECS: SecretSpec[] = [
  {
    name: 'AES Encryption Key',
    envVar: 'ENCRYPTION_KEY',
    required: true,
    minLength: 64,
    pattern: /^[0-9a-fA-F]{64}$/,
    patternDescription: 'must be 64 hexadecimal characters (256 bits)',
  },
  {
    name: 'Key Encryption Key',
    envVar: 'KEK_KEY',
    required: true,
    minLength: 64,
    pattern: /^[0-9a-fA-F]{64}$/,
    patternDescription: 'must be 64 hexadecimal characters (256 bits)',
  },
  {
    name: 'OTP HMAC Secret',
    envVar: 'OTP_HMAC_SECRET',
    required: true,
    minLength: 32,
  },
  {
    name: 'Session HMAC Secret',
    envVar: 'SESSION_HMAC_SECRET',
    required: true,
    minLength: 32,
  },
  {
    name: 'NextAuth Secret',
    envVar: 'NEXTAUTH_SECRET',
    required: true,
    minLength: 32,
  },
];

/** Check if a secret string is trivially weak (e.g. repeated characters or common placeholder). */
export function isTriviallyWeakSecret(val: string): boolean {
  const trimmed = val.trim();
  if (trimmed.length === 0) return true;
  // All characters identical (e.g., '0000000...', 'aaaaaa...')
  if (/^(.)\1+$/.test(trimmed)) return true;
  // Common trivial placeholders
  const lower = trimmed.toLowerCase();
  const weakPlaceholders = [
    'password',
    'changeme',
    'secret',
    'default',
    '1234567890',
    'abcdefghijklmnopqrstuvwxyz',
  ];
  return weakPlaceholders.some(p => lower.includes(p) && trimmed.length <= p.length + 8);
}

/**
 * Validates that all cryptographic secrets are present, strong, and distinct.
 *
 * @param customEnv Optional environment dictionary (defaults to process.env).
 * @throws Error if any secret is missing, weak, invalid, or duplicated.
 */
export function validateCryptoSecrets(customEnv?: NodeJS.ProcessEnv): void {
  const env = customEnv || process.env;
  const errors: string[] = [];

  // ── 1. Presence, format & strength ──────────────────────────────
  for (const spec of SECRET_SPECS) {
    const rawValue = env[spec.envVar];
    const value = rawValue?.trim();

    if (!value) {
      if (spec.required) {
        errors.push(`${spec.name} (${spec.envVar}) is missing`);
      }
      continue;
    }

    if (value.length < spec.minLength) {
      errors.push(
        `${spec.name} (${spec.envVar}) is too short: ${value.length} chars, need >=${spec.minLength}`
      );
      continue;
    }

    if (spec.pattern && !spec.pattern.test(value)) {
      errors.push(
        `${spec.name} (${spec.envVar}) has invalid format: ${spec.patternDescription || 'format check failed'}`
      );
      continue;
    }

    if (isTriviallyWeakSecret(value)) {
      errors.push(
        `${spec.name} (${spec.envVar}) is dangerously weak (trivial or repeated pattern)`
      );
    }
  }

  // ── 2. Uniqueness — no two secrets may share the same value ────
  const seen = new Map<string, string>(); // value → first envVar name
  for (const spec of SECRET_SPECS) {
    const value = env[spec.envVar]?.trim();
    if (!value) continue;

    const existing = seen.get(value);
    if (existing) {
      errors.push(
        `${spec.envVar} has the same value as ${existing} — cryptographic secrets MUST be distinct`
      );
    } else {
      seen.set(value, spec.envVar);
    }
  }

  // ── 3. Production Storage Validation ────────────────────────────
  const isProduction = env.NODE_ENV === 'production';
  const storageProvider = (env.STORAGE_PROVIDER || '').trim().toLowerCase();

  if (isProduction) {
    if (storageProvider === 'local') {
      errors.push('STORAGE_PROVIDER=local is prohibited in production. Use mongodb.');
    }
    const mongoUri = env.MONGODB_URI?.trim();
    if (!mongoUri) {
      errors.push('MONGODB_URI is required in production for GridFS persistent file storage');
    } else if (!mongoUri.startsWith('mongodb://') && !mongoUri.startsWith('mongodb+srv://')) {
      errors.push('MONGODB_URI has invalid protocol (must start with mongodb:// or mongodb+srv://)');
    }
  }

  // ── Report ──────────────────────────────────────────────────────
  if (errors.length > 0) {
    const header = 'Cryptographic secret validation failed:';
    const body = errors.map((e, i) => `  ${i + 1}. ${e}`).join('\n');
    throw new Error(`${header}\n${body}`);
  }
}
