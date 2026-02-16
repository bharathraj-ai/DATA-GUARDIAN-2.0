import { PrismaClient } from '@prisma/client';

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

// Create client with optimized connection pooling
function createPrismaClient(): PrismaClient {
  const client = new PrismaClient({
    // Minimal logging for performance — only errors
    log: ['error'],
    // Connection pool tuning for serverless/edge
    datasourceUrl: process.env.DATABASE_URL,
  });

  // Warm the connection pool on creation (prevents cold-start latency)
  client.$connect().catch(() => { });

  return client;
}

// Use existing client or create new one (singleton pattern)
export const prisma = globalForPrisma.prisma ?? createPrismaClient();

// Cache client in development to prevent hot-reload connection leaks
if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma;
}
