import { Resolver } from 'dns/promises';
import { MongoClient, GridFSBucket, Db, ServerApiVersion } from 'mongodb';
import { logger } from '@/lib/logger';

// ─── Environment Validation ─────────────────────────────────────────
function getRequiredEnv(key: string): string {
  const value = process.env[key];
  if (!value || value.trim() === '') {
    throw new Error(
      `[Mongo] Missing required environment variable: ${key}. ` +
      `MongoDB operations are disabled until all credentials are configured.`
    );
  }
  return value.trim();
}

let _expandedSrvUri: string | null = null;

/**
 * Windows / some local resolvers refuse Node `querySrv` for mongodb+srv
 * (ECONNREFUSED) even when Atlas records exist. Expand SRV via public DNS
 * into a standard mongodb:// multi-host URI so the driver never calls querySrv.
 */
async function expandMongoSrvUri(uri: string): Promise<string> {
  if (!uri.startsWith('mongodb+srv://')) return uri;
  if (_expandedSrvUri) return _expandedSrvUri;

  const withoutScheme = uri.slice('mongodb+srv://'.length);
  const at = withoutScheme.lastIndexOf('@');
  const creds = at >= 0 ? withoutScheme.slice(0, at) : '';
  const hostAndRest = at >= 0 ? withoutScheme.slice(at + 1) : withoutScheme;

  const slash = hostAndRest.indexOf('/');
  const hostPart = slash >= 0 ? hostAndRest.slice(0, slash) : hostAndRest;
  const pathAndQuery = slash >= 0 ? hostAndRest.slice(slash) : '/';

  const qInHost = hostPart.indexOf('?');
  const hostname = (qInHost >= 0 ? hostPart.slice(0, qInHost) : hostPart).split(':')[0];
  const hostQuery = qInHost >= 0 ? hostPart.slice(qInHost + 1) : '';

  const pathOnly = pathAndQuery.split('?')[0] || '/';
  const pathQuery = pathAndQuery.includes('?') ? pathAndQuery.split('?')[1] : '';
  const mergedQuery = [hostQuery, pathQuery].filter(Boolean).join('&');

  const resolver = new Resolver();
  resolver.setServers(['8.8.8.8', '1.1.1.1', '8.8.4.4']);

  const srv = await resolver.resolveSrv(`_mongodb._tcp.${hostname}`);
  if (!srv.length) {
    throw new Error(`[Mongo] No SRV records found for ${hostname}`);
  }

  const txtLists = await resolver.resolveTxt(hostname).catch(() => [] as string[][]);
  const txt = txtLists.map((parts) => parts.join('')).join('');

  const hosts = srv
    .map((record) => `${record.name}:${record.port || 27017}`)
    .join(',');

  const params = new URLSearchParams(mergedQuery);
  params.set('tls', 'true');
  if (txt) {
    for (const part of txt.split('&')) {
      const [key, value] = part.split('=');
      if (key && !params.has(key)) {
        params.set(key, value ?? '');
      }
    }
  }

  const auth = creds ? `${creds}@` : '';
  _expandedSrvUri = `mongodb://${auth}${hosts}${pathOnly}?${params.toString()}`;
  return _expandedSrvUri;
}

// ─── Lazy Singleton ─────────────────────────────────────────────────
let _mongoClient: MongoClient | null = null;
let _db: Db | null = null;
let _gridFSBucket: GridFSBucket | null = null;
let _connecting: Promise<MongoClient> | null = null;

/** 1 MiB GridFS chunks — fewer round-trips than the 255 KiB default. */
export const GRIDFS_CHUNK_SIZE = 1024 * 1024;

export async function getMongoClient(): Promise<MongoClient> {
  if (_mongoClient) return _mongoClient;
  if (_connecting) return _connecting;

  _connecting = (async () => {
    const rawUri = getRequiredEnv('MONGODB_URI');
    const uri = await expandMongoSrvUri(rawUri);
    const client = new MongoClient(uri, {
      maxPoolSize: 10,
      minPoolSize: 1,
      maxIdleTimeMS: 600_000,
      connectTimeoutMS: 15_000,
      socketTimeoutMS: 45_000,
      serverSelectionTimeoutMS: 20_000,
      heartbeatFrequencyMS: 10_000,
      // Streaming hellos often die on Windows/NAT ("server monitor timeout").
      serverMonitoringMode: 'poll',
      // Don't wait for replica-set majority — that added multiple seconds per small upload.
      writeConcern: { w: 1, wtimeoutMS: 8000 },
      retryWrites: true,
      retryReads: true,
      serverApi: {
        version: ServerApiVersion.v1,
        strict: false,
        deprecationErrors: false,
      },
      tls: true,
      family: 4, // Force IPv4 to prevent Windows OpenSSL alert 80 with Atlas
    });

    try {
      await client.connect();
      _mongoClient = client;
      logger.info('[Mongo] Client connected.');
      return client;
    } catch (error) {
      try {
        await client.close();
      } catch {
        /* ignore */
      }
      _mongoClient = null;
      _db = null;
      _gridFSBucket = null;
      throw error;
    } finally {
      _connecting = null;
    }
  })();

  return _connecting;
}

export async function getMongoDb(): Promise<Db> {
  if (_db) return _db;
  const client = await getMongoClient();
  const dbName = process.env.MONGODB_DB_NAME || 'data-guardian';
  _db = client.db(dbName);
  return _db;
}

export async function getGridFSBucket(): Promise<GridFSBucket> {
  if (_gridFSBucket) return _gridFSBucket;
  const db = await getMongoDb();
  _gridFSBucket = new GridFSBucket(db, {
    bucketName: 'uploads',
    chunkSizeBytes: GRIDFS_CHUNK_SIZE,
  });
  return _gridFSBucket;
}

export function isMongoConfigured(): boolean {
  try {
    getRequiredEnv('MONGODB_URI');
    return true;
  } catch {
    return false;
  }
}

/** Best-effort warm connect so the first upload/download is not a cold TLS+SRV hit. */
export async function warmMongoConnection(): Promise<void> {
  if (!isMongoConfigured()) return;
  await getMongoClient();
}

export function isTransientMongoError(error: unknown): boolean {
  const msg = error instanceof Error ? error.message : String(error);
  const name = error instanceof Error ? error.name : '';
  return (
    name === 'MongoNetworkError' ||
    name === 'MongoServerSelectionError' ||
    name === 'MongoNetworkTimeoutError' ||
    /server monitor timeout|interrupted|ECONNRESET|ETIMEDOUT|ENOTFOUND|ECONNREFUSED|not connected|connection.*closed|topology was destroyed|MongoExpiredSessionError|SSL|tls/i.test(
      msg,
    )
  );
}

export function mongoFriendlyError(error: unknown): string {
  if (isTransientMongoError(error)) {
    return 'Could not reach file storage. Please attach the file again.';
  }
  return error instanceof Error ? error.message : 'File storage failed.';
}

export async function resetMongoConnection(): Promise<void> {
  const client = _mongoClient;
  _mongoClient = null;
  _db = null;
  _gridFSBucket = null;
  _connecting = null;
  if (client) {
    await client.close().catch(() => {});
  }
}

export async function withMongoRetry<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    if (!isTransientMongoError(error)) throw error;
    logger.warn('[Mongo] Stale connection — reconnecting and retrying once', {
      message: error instanceof Error ? error.message : String(error),
    });
    await resetMongoConnection();
    await getMongoClient();
    return work();
  }
}
