import { PrismaClient } from '@prisma/client';

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
  _prismaShutdownRegistered?: boolean;
};

function buildDatasourceUrl(): string {
  let url = process.env.DATABASE_URL || '';
  if (!url) return url;

  try {
    const parsed = new URL(url);
    // Long-lived Next.js process (dev/standalone): small pool is fine with PgBouncer,
    // but 5 is too tight when dashboard fires multiple queries + cleanup.
    // Neon serverless: prefer pooled host + pgbouncer=true.
    // Small client pool (PgBouncer multiplexes). High limits + 60s waits
    // queue every request behind exhausted SSE/txn slots (P2024).
    const defaultLimit = process.env.NODE_ENV === 'development' ? '15' : '12';
    parsed.searchParams.set(
      'connection_limit',
      process.env.PRISMA_CONNECTION_LIMIT || defaultLimit,
    );
    parsed.searchParams.set('pool_timeout', process.env.PRISMA_POOL_TIMEOUT || '10');
    if (!parsed.searchParams.has('connect_timeout')) {
      parsed.searchParams.set('connect_timeout', '20');
    }
    // Required when using the Neon *-pooler* host
    if (!parsed.searchParams.has('pgbouncer')) {
      parsed.searchParams.set('pgbouncer', 'true');
    }
    return parsed.toString();
  } catch {
    return url;
  }
}

function isTransientPrismaError(error: unknown): boolean {
  const msg = error instanceof Error ? error.message : String(error);
  const code = (error as { code?: string })?.code;
  // Do NOT retry P2024 (pool timeout). Retrying re-queues waiters and
  // makes create-link / dashboard starve for another full pool_timeout.
  return (
    code === 'P1017' ||
    code === 'P1001' ||
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

  // Retry transient Neon/pool errors WITHOUT $disconnect().
  // Disconnecting mid-flight starves parallel queries and causes P2024 pool timeouts.
  const extended = client.$extends({
    query: {
      async $allOperations({ model, operation, args, query }) {
        if (model === 'AuditLog' && operation === 'create') {
          const data = (args as { data?: { ownerId?: string | null; linkId?: string | null } }).data;
          if (data && !data.ownerId && data.linkId) {
            const link = await client.secureLink.findUnique({
              where: { id: data.linkId },
              select: { ownerId: true },
            });
            if (link?.ownerId) {
              data.ownerId = link.ownerId;
            }
          }
        }

        try {
          return await query(args);
        } catch (error) {
          if (!isTransientPrismaError(error)) throw error;

          console.warn('[Prisma] Transient DB error — retrying once…');
          await sleep(250);
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

// Only disconnect on real process shutdown in production (avoids HMR Closed errors in dev)
if (process.env.NODE_ENV === 'production' && !globalForPrisma._prismaShutdownRegistered) {
  globalForPrisma._prismaShutdownRegistered = true;
  process.on('SIGTERM', async () => {
    await prisma.$disconnect().catch(() => {});
  });
}
