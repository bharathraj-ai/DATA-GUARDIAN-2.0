import { MongoClient, GridFSBucket, Db, ServerApiVersion } from 'mongodb';

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

// ─── Lazy Singleton ─────────────────────────────────────────────────
let _mongoClient: MongoClient | null = null;
let _db: Db | null = null;
let _gridFSBucket: GridFSBucket | null = null;

export async function getMongoClient(): Promise<MongoClient> {
  if (_mongoClient) return _mongoClient;

  const uri = getRequiredEnv('MONGODB_URI');
  _mongoClient = new MongoClient(uri, {
    maxPoolSize: 10,
    minPoolSize: 0,            // Don't force connections on startup (prevents cold-start hangs)
    connectTimeoutMS: 10000,   // 10s connection timeout (was unlimited)
    socketTimeoutMS: 30000,    // 30s socket timeout
    serverSelectionTimeoutMS: 10000, // 10s server selection timeout
    serverApi: {
      version: ServerApiVersion.v1,
      strict: true,
      deprecationErrors: true,
    },
    tls: true,
    family: 4, // Force IPv4 to prevent Windows OpenSSL alert 80 with Atlas
  });

  await _mongoClient.connect();
  console.log(`[Mongo] Client connected.`);
  return _mongoClient;
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
    bucketName: 'uploads'
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
