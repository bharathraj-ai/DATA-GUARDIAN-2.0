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
    // Neon PgBouncer: keep the pool small. Large pools leave idle sockets
    // that Neon closes → "Error { kind: Closed, cause: None }".
    parsed.searchParams.set('connection_limit', '5');
    if (!parsed.searchParams.has('pool_timeout')) {
      parsed.searchParams.set('pool_timeout', '20');
    }
    if (!parsed.searchParams.has('connect_timeout')) {
      parsed.searchParams.set('connect_timeout', '15');
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

function isClosedConnectionError(error: unknown): boolean {
  const msg = error instanceof Error ? error.message : String(error);
  const code = (error as { code?: string })?.code;
  return (
    code === 'P1017' ||
    code === 'P1001' ||
    /kind:\s*Closed/i.test(msg) ||
    /Connection.*closed/i.test(msg) ||
    /Server has closed the connection/i.test(msg) ||
    /Can't reach database server/i.test(msg)
  );
}

function createPrismaClient(): PrismaClient {
  const client = new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['error', 'warn'] : ['error'],
    datasourceUrl: buildDatasourceUrl(),
  });

  // Retry once when Neon/PgBouncer drops an idle connection.
  // Do NOT call $connect() at module load — that opens a socket which Neon
  // later closes while the process is idle (cleanup scheduler, etc.).
  const extended = client.$extends({
    query: {
      async $allOperations({ args, query }) {
        try {
          return await query(args);
        } catch (error) {
          if (!isClosedConnectionError(error)) throw error;

          console.warn('[Prisma] Idle connection closed by Neon — reconnecting…');
          try {
            await client.$disconnect();
          } catch {
            // ignore disconnect failures on already-closed sockets
          }
          await client.$connect();
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
