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
    parsed.searchParams.set('connection_limit', process.env.NODE_ENV === 'development' ? '10' : '7');
    parsed.searchParams.set('pool_timeout', '60');
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
  return (
    code === 'P1017' ||
    code === 'P1001' ||
    code === 'P2024' || // connection pool timeout
    /kind:\s*Closed/i.test(msg) ||
    /Connection.*closed/i.test(msg) ||
    /Server has closed the connection/i.test(msg) ||
    /Can't reach database server/i.test(msg) ||
    /Timed out fetching a new connection/i.test(msg)
  );
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function createPrismaClient(): PrismaClient {
  const client = new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['error', 'warn'] : ['error'],
    datasourceUrl: buildDatasourceUrl(),
  });

  // Retry transient Neon/pool errors WITHOUT $disconnect().
  // Disconnecting mid-flight starves parallel queries and causes P2024 pool timeouts.
  const extended = client.$extends({
    query: {
      async $allOperations({ args, query }) {
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
