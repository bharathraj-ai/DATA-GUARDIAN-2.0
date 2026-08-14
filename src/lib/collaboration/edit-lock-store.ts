/**
 * Atomic compare-and-swap store for editing locks.
 * Redis (Upstash Lua) is the production backend. A process-local map is used
 * only when Redis is not configured (single-instance dev). If Redis IS
 * configured but errors, operations fail closed.
 */

import { isRedisConfigured } from '@/lib/redis-helpers';
import { logger } from '@/lib/logger';
import {
    EditLockUnavailableError,
    editLockEventKey,
    editLockKey,
    parseEditingLock,
    type EditLockEvent,
    type EditingLock,
} from './edit-lock-types';

const CAS_LUA = `
local key = KEYS[1]
local expected = ARGV[1]
local newval = ARGV[2]
local ttl = tonumber(ARGV[3])
local current = redis.call('GET', key)
if current == false or current == nil then
  current = ''
end
if type(current) ~= 'string' then
  current = tostring(current)
end
if current == expected then
  if newval == '' then
    redis.call('DEL', key)
    return {1, ''}
  end
  redis.call('SET', key, newval, 'EX', ttl)
  return {1, newval}
end
return {0, current}
`;

export interface EditLockCasResult {
    ok: boolean;
    current: string;
}

export interface EditLockStore {
    get(documentId: string): Promise<EditingLock | null>;
    getMany(documentIds: string[]): Promise<(EditingLock | null)[]>;
    cas(documentId: string, expectedJson: string, next: EditingLock | null, ttlSeconds: number): Promise<EditLockCasResult>;
    publishEvent(token: string, event: EditLockEvent, ttlSeconds?: number): Promise<void>;
    getEvent(token: string): Promise<EditLockEvent | null>;
}

type MemoryEntry = { json: string; expiresAt: number };

const memoryLocks = new Map<string, MemoryEntry>();
const memoryEvents = new Map<string, { json: string; expiresAt: number }>();
let memoryChain: Promise<unknown> = Promise.resolve();

function runExclusive<T>(fn: () => T): Promise<T> {
    const next = memoryChain.then(() => fn(), () => fn());
    memoryChain = next.then(() => undefined, () => undefined);
    return next;
}

function serializeLock(lock: EditingLock | null): string {
    return lock ? JSON.stringify(lock) : '';
}

const memoryStore: EditLockStore = {
    async get(documentId) {
        const key = editLockKey(documentId);
        const entry = memoryLocks.get(key);
        if (!entry || entry.expiresAt <= Date.now()) {
            if (entry) memoryLocks.delete(key);
            return null;
        }
        return parseEditingLock(entry.json);
    },
    async getMany(documentIds) {
        return Promise.all(documentIds.map((id) => memoryStore.get(id)));
    },
    async cas(documentId, expectedJson, next, ttlSeconds) {
        return runExclusive(() => {
            const key = editLockKey(documentId);
            const now = Date.now();
            const entry = memoryLocks.get(key);
            const current = !entry || entry.expiresAt <= now ? '' : entry.json;
            if (current !== expectedJson) {
                return { ok: false, current };
            }
            const newJson = serializeLock(next);
            if (!newJson) {
                memoryLocks.delete(key);
                return { ok: true, current: '' };
            }
            memoryLocks.set(key, { json: newJson, expiresAt: now + ttlSeconds * 1000 });
            return { ok: true, current: newJson };
        });
    },
    async publishEvent(token, event, ttlSeconds = 180) {
        memoryEvents.set(editLockEventKey(token), {
            json: JSON.stringify(event),
            expiresAt: Date.now() + ttlSeconds * 1000,
        });
    },
    async getEvent(token) {
        const entry = memoryEvents.get(editLockEventKey(token));
        if (!entry || entry.expiresAt <= Date.now()) return null;
        try {
            return JSON.parse(entry.json) as EditLockEvent;
        } catch {
            return null;
        }
    },
};

function normalizeEvalResult(raw: unknown): EditLockCasResult {
    const arr = Array.isArray(raw) ? raw : null;
    if (!arr || arr.length < 2) {
        return { ok: false, current: '' };
    }
    const ok = arr[0] === 1 || arr[0] === '1';
    let current = arr[1];
    if (current == null) current = '';
    if (typeof current !== 'string') current = JSON.stringify(current);
    return { ok, current };
}

async function redisStore(): Promise<EditLockStore> {
    const { default: redis } = await import('@/lib/redis');
    return {
        async get(documentId) {
            const raw = await redis.get<string>(editLockKey(documentId));
            return parseEditingLock(raw);
        },
        async getMany(documentIds) {
            if (documentIds.length === 0) return [];
            const keys = documentIds.map(editLockKey);
            const raws = await redis.mget(...keys);
            const list = (Array.isArray(raws) ? raws : [raws]) as Array<string | null | undefined>;
            return documentIds.map((_, i) => parseEditingLock(list[i] ?? null));
        },
        async cas(documentId, expectedJson, next, ttlSeconds) {
            const raw = await redis.eval(CAS_LUA, [editLockKey(documentId)], [
                expectedJson,
                serializeLock(next),
                ttlSeconds,
            ]);
            return normalizeEvalResult(raw);
        },
        async publishEvent(token, event, ttlSeconds = 180) {
            await redis.set(editLockEventKey(token), JSON.stringify(event), { ex: ttlSeconds });
        },
        async getEvent(token) {
            const raw = await redis.get<string>(editLockEventKey(token));
            if (!raw) return null;
            try {
                return typeof raw === 'string' ? JSON.parse(raw) as EditLockEvent : raw as EditLockEvent;
            } catch {
                return null;
            }
        },
    };
}

let injectedStore: EditLockStore | null = null;

/** Test-only injection. */
export function setEditLockStoreForTests(store: EditLockStore | null) {
    injectedStore = store;
}

export function resetMemoryEditLockStoreForTests() {
    memoryLocks.clear();
    memoryEvents.clear();
}

export async function getEditLockStore(): Promise<EditLockStore> {
    if (injectedStore) return injectedStore;
    if (!isRedisConfigured()) {
        return memoryStore;
    }
    try {
        return await redisStore();
    } catch (err) {
        logger.error('Edit-lock Redis init failed — fail closed', err);
        throw new EditLockUnavailableError();
    }
}

export async function withEditLockStore<T>(fn: (store: EditLockStore) => Promise<T>): Promise<T> {
    try {
        const store = await getEditLockStore();
        return await fn(store);
    } catch (err) {
        if (err instanceof EditLockUnavailableError) throw err;
        if (isRedisConfigured()) {
            logger.error('Edit-lock Redis operation failed — fail closed', err);
            throw new EditLockUnavailableError();
        }
        throw err;
    }
}

export { serializeLock };
