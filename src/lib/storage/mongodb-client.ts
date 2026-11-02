import { Resolver } from 'dns/promises';
import { MongoClient, GridFSBucket, Db, ServerApiVersion, ObjectId } from 'mongodb';
import { logger } from '@/lib/logger';

export { ObjectId };

export const DEFAULT_GRIDFS_BUCKET = 'data_guardian_files';
export const GRIDFS_CHUNK_SIZE = 1024 * 1024; // 1 MiB chunks for high throughput

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

  try {
    const resolver = new Resolver();
    resolver.setServers(['8.8.8.8', '1.1.1.1', '8.8.4.4']);

    const srv = await resolver.resolveSrv(`_mongodb._tcp.${hostname}`);
    if (srv.length > 0) {
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
  } catch (err) {
    logger.warn('[Mongo] DNS SRV expansion fallback to original URI:', err);
  }

  return uri;
}

// ─── Lazy Singleton Client & Bucket Cache ─────────────────────────────────────
let _mongoClient: MongoClient | null = null;
let _db: Db | null = null;
const _buckets = new Map<string, GridFSBucket>();
let _connecting: Promise<MongoClient> | null = null;

export function getMongoConfig() {
  const uri = process.env.MONGODB_URI?.trim();
  const dbName = process.env.MONGODB_DATABASE?.trim() || process.env.MONGODB_DB_NAME?.trim() || 'data-guardian';
  const bucketName = process.env.MONGODB_GRIDFS_BUCKET?.trim() || DEFAULT_GRIDFS_BUCKET;

  return {
    uri,
    dbName,
    bucketName,
    isConfigured: Boolean(uri && !uri.includes('your-mongodb') && !uri.includes('placeholder')),
  };
}

export async function getMongoClient(): Promise<MongoClient> {
  if (_mongoClient) return _mongoClient;
  if (_connecting) return _connecting;

  const config = getMongoConfig();
  if (!config.uri) {
    throw new Error(
      '[Mongo] Missing required environment variable MONGODB_URI. ' +
      'MongoDB GridFS operations cannot proceed without a valid connection URI.'
    );
  }

  _connecting = (async () => {
    try {
      const uri = await expandMongoSrvUri(config.uri!);
      const client = new MongoClient(uri, {
        maxPoolSize: 20,
        minPoolSize: 2,
        maxIdleTimeMS: 600_000,
        connectTimeoutMS: 15_000,
        socketTimeoutMS: 45_000,
        serverSelectionTimeoutMS: 20_000,
        heartbeatFrequencyMS: 10_000,
        serverMonitoringMode: 'poll',
        writeConcern: { w: 1, wtimeoutMS: 8000 },
        retryWrites: true,
        retryReads: true,
        serverApi: {
          version: ServerApiVersion.v1,
          strict: false,
          deprecationErrors: false,
        },
        tls: true,
        family: 4, // Prevent IPv6 timeout/OpenSSL alert 80
      });

      await client.connect();
      _mongoClient = client;
      logger.info('[Mongo] MongoDB GridFS connection established with connection pooling.');
      return client;
    } catch (error) {
      _mongoClient = null;
      _db = null;
      _buckets.clear();
      logger.error('[Mongo] Failed to connect to MongoDB cluster:', error);
      throw error;
    } finally {
      _connecting = null;
    }
  })();

  return _connecting;
}

export async function getMongoDb(): Promise<Db> {
  if (_db && _mongoClient) return _db;
  const client = await getMongoClient();
  const { dbName } = getMongoConfig();
  _db = client.db(dbName);
  return _db;
}

export async function getGridFSBucket(bucketName?: string): Promise<GridFSBucket> {
  const name = bucketName || getMongoConfig().bucketName;
  const cached = _buckets.get(name);
  if (cached && _mongoClient) return cached;

  const db = await getMongoDb();
  const bucket = new GridFSBucket(db, {
    bucketName: name,
    chunkSizeBytes: GRIDFS_CHUNK_SIZE,
  });

  _buckets.set(name, bucket);
  return bucket;
}

export async function checkMongoConnection(): Promise<{ healthy: boolean; latencyMs: number; error?: string }> {
  const start = Date.now();
  try {
    const db = await getMongoDb();
    await db.command({ ping: 1 });
    return {
      healthy: true,
      latencyMs: Date.now() - start,
    };
  } catch (err: any) {
    return {
      healthy: false,
      latencyMs: Date.now() - start,
      error: err?.message || 'MongoDB ping failed',
    };
  }
}

export async function closeMongoClient(): Promise<void> {
  if (_mongoClient) {
    try {
      await _mongoClient.close();
    } catch {
      // ignore
    }
    _mongoClient = null;
    _db = null;
    _buckets.clear();
    _connecting = null;
  }
}

