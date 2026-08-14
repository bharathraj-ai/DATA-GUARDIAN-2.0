import { PrismaClient } from '@prisma/client';
import { logger } from '@/lib/logger';

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
  _prismaShutdownRegistered?: boolean;
};

const READ_OPERATIONS = new Set([
  'findUnique',
  'findUniqueOrThrow',
  'findFirst',
  'findFirstOrThrow',
  'findMany',
  'count',
  'aggregate',
  'groupBy',
]);

const OWNER_ID_CACHE_TTL_MS = 60_000;
const OWNER_ID_CACHE_MAX = 500;
const ownerIdCache = new Map<string, { ownerId: string; expiresAt: number }>();

function cacheOwnerId(linkId: string, ownerId: string) {
  if (ownerIdCache.size >= OWNER_ID_CACHE_MAX) {
    const oldest = ownerIdCache.keys().next().value;
    if (oldest) ownerIdCache.delete(oldest);
  }
  ownerIdCache.set(linkId, { ownerId, expiresAt: Date.now() + OWNER_ID_CACHE_TTL_MS });
}

function getCachedOwnerId(linkId: string): string | null {
  const entry = ownerIdCache.get(linkId);
  if (!entry) return null;
  if (entry.expiresAt <= Date.now()) {
    ownerIdCache.delete(linkId);
    return null;
  }
  return entry.ownerId;
}

function resolveRawUrl(): string {
  // Dev: prefer DIRECT_URL so interactive $transaction works (no PgBouncer).
  if (process.env.NODE_ENV !== 'production' && process.env.DIRECT_URL) {
    return process.env.DIRECT_URL;
  }
  return process.env.DATABASE_URL || process.env.DIRECT_URL || '';
}

function isPoolerHost(url: string): boolean {
  try {
    return new URL(url).hostname.includes('-pooler');
  } catch {
    return /pooler|pgbouncer/i.test(url);
  }
}

function buildDatasourceUrl(): string {
  const url = resolveRawUrl();
  if (!url) return url;

  try {
    const parsed = new URL(url);
    const usingPooler = isPoolerHost(url) || parsed.searchParams.get('pgbouncer') === 'true';
    // Dev direct compute has a tiny Neon max_connections budget — keep this low
    // or Neon issues E57P01 ("terminating connection due to administrator command").
    // Direct Neon compute is small, but 3 is too tight: RSC + server actions +
    // OAuth adapter queries overlap and hit P2024 (pool timeout).
    const defaultLimit = usingPooler
      ? (process.env.NODE_ENV === 'development' ? '5' : '10')
      : (process.env.NODE_ENV === 'development' ? '5' : '12');

    parsed.searchParams.set(
      'connection_limit',
      process.env.PRISMA_CONNECTION_LIMIT || defaultLimit,
    );
    parsed.searchParams.set('pool_timeout', process.env.PRISMA_POOL_TIMEOUT || '15');
    if (!parsed.searchParams.has('connect_timeout')) {
      parsed.searchParams.set('connect_timeout', '15');
    }
    if (usingPooler && !parsed.searchParams.has('pgbouncer')) {
      parsed.searchParams.set('pgbouncer', 'true');
    }
    return parsed.toString();
  } catch {
    return url;
  }
}

function isAdminTerminatedConnection(error: unknown): boolean {
  const msg = error instanceof Error ? error.message : String(error);
  const code = (error as { code?: string })?.code;
  return (
    code === 'P1017' ||
    /57P01/i.test(msg) ||
    /terminating connection due to administrator command/i.test(msg) ||
    /server closed the connection unexpectedly/i.test(msg)
  );
}

function isTransientPrismaError(error: unknown): boolean {
  const msg = error instanceof Error ? error.message : String(error);
  const code = (error as { code?: string })?.code;
  return (
    isAdminTerminatedConnection(error) ||
    code === 'P1001' ||
    code === 'P1008' ||
    /kind:\s*Closed/i.test(msg) ||
    /Connection.*closed/i.test(msg) ||
    /Server has closed the connection/i.test(msg) ||
    /Can't reach database server/i.test(msg)
  );
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function createPrismaClient(): PrismaClient {
  const datasourceUrl = buildDatasourceUrl();
  // During `next build` page collection, env may be unset — avoid hard-crash.
  // Runtime requests must still have DATABASE_URL configured on Vercel.
  if (!datasourceUrl && process.env.NEXT_PHASE === 'phase-production-build') {
    return new PrismaClient({
      log: ['error'],
    });
  }

  const client = new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['error', 'warn'] : ['error'],
    ...(datasourceUrl ? { datasourceUrl } : {}),
  });

  const extended = client.$extends({
    query: {
      async $allOperations({ model, operation, args, query }) {
        if (model === 'AuditLog' && operation === 'create') {
          const data = (args as { data?: { ownerId?: string | null; linkId?: string | null } }).data;
          if (data && !data.ownerId && data.linkId) {
            const cached = getCachedOwnerId(data.linkId);
            if (cached) {
              data.ownerId = cached;
            } else {
              const link = await client.secureLink.findUnique({
                where: { id: data.linkId },
                select: { ownerId: true },
              });
              if (link?.ownerId) {
                data.ownerId = link.ownerId;
                cacheOwnerId(data.linkId, link.ownerId);
              }
            }
          }
        }

        try {
          return await query(args);
        } catch (error) {
          const killed = isAdminTerminatedConnection(error);
          if (!isTransientPrismaError(error)) throw error;
          // Neon E57P01 aborts the backend — safe to retry once after disconnect.
          // Other transients: retry reads only (avoid duplicate writes).
          if (!killed && !READ_OPERATIONS.has(operation)) throw error;

          logger.warn('Prisma transient DB error — reconnecting and retrying once', {
            operation,
            model,
            killed,
          });
          await client.$disconnect().catch(() => {});
          await sleep(killed ? 400 : 250);
          return query(args);
        }
      },
    },
  });

  return extended as unknown as PrismaClient;
}

export const prisma = globalForPrisma.prisma ?? createPrismaClient();

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma;
}

if (process.env.NODE_ENV === 'production' && !globalForPrisma._prismaShutdownRegistered) {
  globalForPrisma._prismaShutdownRegistered = true;
  process.on('SIGTERM', async () => {
    await prisma.$disconnect().catch(() => {});
  });
}
