import { PrismaClient } from '@prisma/client';

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
  _prismaShutdownRegistered?: boolean;
};

// Create client with optimized connection pooling
function createPrismaClient(): PrismaClient {
  // Ensure DATABASE_URL has connection_limit=20
  let url = process.env.DATABASE_URL || '';
  if (url && !url.includes('connection_limit=')) {
      url = url.includes('?') ? `${url}&connection_limit=20` : `${url}?connection_limit=20`;
  } else if (url) {
      url = url.replace(/connection_limit=\d+/, 'connection_limit=20');
  }

  const client = new PrismaClient({
    log: ['error', 'warn'],
    datasourceUrl: url,
  });

  // Safe connection lifecycle & retry strategy
  const connectWithRetry = async (retries = 3) => {
      for (let i = 0; i < retries; i++) {
          try {
              await client.$connect();
              break;
          } catch (error) {
              console.error(`[Prisma] Connection failed (Attempt ${i + 1}/${retries}):`, error);
              if (i === retries - 1) throw error;
              await new Promise(resolve => setTimeout(resolve, 1000 * (i + 1))); // Exponential backoff
          }
      }
  };

  // Warm the connection pool on creation (prevents cold-start latency)
  connectWithRetry().catch((e) => console.error('[Prisma] Final connection failure:', e));

  return client;
}

// Use existing client or create new one (singleton pattern)
export const prisma = globalForPrisma.prisma ?? createPrismaClient();

// Cache client in development to prevent hot-reload connection leaks
if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma;
}

// Register SIGTERM handler ONCE (outside the factory to prevent listener leaks on hot reload)
if (!globalForPrisma._prismaShutdownRegistered) {
  globalForPrisma._prismaShutdownRegistered = true;
  process.on('SIGTERM', async () => {
      console.log('[Prisma] SIGTERM received, disconnecting pool...');
      await prisma.$disconnect();
  });
}
