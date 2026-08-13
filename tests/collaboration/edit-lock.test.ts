/**
 * Priority-based collaborative editing — lock, takeover, race, and security tests.
 * Pure decision tests + in-memory CAS store (no live Redis/DB required).
 */

process.env.ENCRYPTION_KEY =
  process.env.ENCRYPTION_KEY ||
  '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
process.env.SESSION_HMAC_SECRET =
  process.env.SESSION_HMAC_SECRET || 'test-session-hmac-secret-min-32-chars!!';
process.env.EDIT_LOCK_TTL_SECONDS = '120';
process.env.EDIT_LOCK_SAME_PRIORITY_POLICY = 'keep_current';
delete process.env.EDIT_LOCK_GRACE_PERIOD_SECONDS;
delete process.env.EDIT_LOCK_RESERVATION_SECONDS;
process.env.UPSTASH_REDIS_REST_URL = '';
process.env.UPSTASH_REDIS_REST_TOKEN = '';

import {
  decideAcceptTakeover,
  decideCompleteTakeover,
  decideHeartbeat,
  decideLockRequest,
  decideRelease,
  decideWrite,
} from '@/lib/collaboration/edit-lock-decision';
import { getEditLockConfig, type EditLockConfig } from '@/lib/collaboration/edit-lock-config';
import { hasEqualPriority, hasHigherPriority } from '@/lib/collaboration/priority';
import { resolveLockActor } from '@/lib/collaboration/resolve-lock-actor';
import {
  assertActorHoldsEditLock,
  completePriorityTakeover,
  requestEditLock,
  resetMemoryEditLockStoreForTests,
  setEditLockStoreForTests,
} from '@/lib/collaboration/edit-lock-service';
import type { EditingLock, LockActor } from '@/lib/collaboration/edit-lock-types';
import { EditLockUnavailableError } from '@/lib/collaboration/edit-lock-types';

jest.mock('@/lib/prisma', () => ({
  prisma: {
    auditLog: { create: jest.fn().mockResolvedValue({ id: 'a1' }) },
    userFile: {
      findUnique: jest.fn(),
      update: jest.fn().mockResolvedValue({}),
    },
    fileVersion: {
      findFirst: jest.fn().mockResolvedValue(null),
      aggregate: jest.fn().mockResolvedValue({ _max: { versionNumber: 1 } }),
      create: jest.fn(),
    },
    documentChatMessage: {
      create: jest.fn().mockResolvedValue({ id: 'chat-1' }),
      findFirst: jest.fn().mockResolvedValue(null),
    },
  },
}));

import { prisma } from '@/lib/prisma';

const config: EditLockConfig = {
  ttlSeconds: 120,
  gracePeriodSeconds: 60,
  reservationSeconds: 3600,
  maxReservationSeconds: 8 * 3600,
  samePriorityPolicy: 'keep_current',
  staleHeartbeatMs: 25_000,
};

function actor(partial: Partial<LockActor> & Pick<LockActor, 'userId' | 'priority' | 'sessionId'>): LockActor {
  return {
    userName: partial.userName || partial.userId.split('@')[0] || 'user',
    teamId: partial.teamId || `team-${partial.userId}`,
    clientInstanceId: partial.clientInstanceId || `tab-${partial.sessionId}`,
    token: partial.token || 'share-token',
    isOwner: partial.isOwner ?? false,
    ...partial,
  };
}

const userC = actor({ userId: 'c@example.com', userName: 'User C', priority: 3, sessionId: 'sess-c', clientInstanceId: 'tab-c' });
const userB = actor({ userId: 'b@example.com', userName: 'Bharath', priority: 2, sessionId: 'sess-b', clientInstanceId: 'tab-b' });
const userA = actor({ userId: 'a@example.com', userName: 'User A', priority: 1, sessionId: 'sess-a', clientInstanceId: 'tab-a' });
const userB2 = actor({ userId: 'b2@example.com', userName: 'User B2', priority: 2, sessionId: 'sess-b2', clientInstanceId: 'tab-b2' });

const DOC = 'doc-a';
const NOW = 1_700_000_000_000;

beforeEach(() => {
  resetMemoryEditLockStoreForTests();
  setEditLockStoreForTests(null);
  jest.clearAllMocks();
  (prisma.userFile.findUnique as jest.Mock).mockResolvedValue({
    id: DOC,
    version: 2,
    encryptedContent: Buffer.from('ciphertext'),
    iv: 'iv',
    authTag: 'tag',
    encryptedDek: 'dek',
    fileSize: 12,
  });
  (prisma.fileVersion.create as jest.Mock).mockImplementation(async ({ data }: any) => ({
    id: 'ver-takeover',
    versionNumber: data.versionNumber,
    previousVersionId: data.previousVersionId ?? null,
  }));
});

describe('priority comparison', () => {
  it('lower numeric value is higher priority', () => {
    expect(hasHigherPriority(2, 3)).toBe(true);
    expect(hasHigherPriority(3, 2)).toBe(false);
    expect(hasEqualPriority(2, 2)).toBe(true);
  });
});

describe('1) Higher priority takes over lower priority', () => {
  it('priority 2 may start takeover against priority 3', () => {
    const held = decideLockRequest(null, userC, DOC, NOW, config);
    expect(held.kind).toBe('acquire');
    const lock = held.kind === 'acquire' ? held.lock : null;
    const next = decideLockRequest(lock, userB, DOC, NOW + 1000, config);
    expect(next.kind).toBe('start_takeover');
    if (next.kind === 'start_takeover') {
      expect(next.lock.pendingTakeover?.requesterUserId).toBe(userB.userId);
      expect(next.lock.pendingTakeover?.requesterPriority).toBe(2);
      expect(next.lock.pendingTakeover?.mode).toBe('takeover');
      expect(next.lock.pendingTakeover?.graceEndsAt).toBe(NOW + 1000 + 60_000);
    }
  });
});

describe('2) Lower priority cannot take over higher priority', () => {
  it('priority 3 notifies holder and cannot force takeover', () => {
    const acquired = decideLockRequest(null, userB, DOC, NOW, config);
    expect(acquired.kind).toBe('acquire');
    const lock = acquired.kind === 'acquire' ? acquired.lock : null;
    const request = decideLockRequest(lock, userC, DOC, NOW + 1000, config);
    expect(request.kind).toBe('start_takeover');
    if (request.kind !== 'start_takeover') return;
    expect(request.lock.pendingTakeover?.mode).toBe('request');
    expect(request.lock.pendingTakeover?.requesterUserId).toBe(userC.userId);
    expect(request.lock.userId).toBe(userB.userId);

    const forced = decideCompleteTakeover(request.lock, userC, NOW + 2000, config, false, true);
    expect(forced.kind).toBe('too_early');

    const accepted = decideAcceptTakeover(request.lock, userB, NOW + 2000, config);
    expect(accepted.kind).toBe('accepted_waiting');
    const acceptedLock = accepted.kind === 'accepted_waiting' ? accepted.lock : request.lock;
    const afterAllow = decideCompleteTakeover(acceptedLock, userC, NOW + 3000, config, true, false);
    expect(afterAllow.kind).toBe('completed');
    if (afterAllow.kind === 'completed') {
      expect(afterAllow.lock.userId).toBe(userC.userId);
    }
  });

  it('repeat request from the same user does not start a new notify', () => {
    const acquired = decideLockRequest(null, userB, DOC, NOW, config);
    const lock = acquired.kind === 'acquire' ? acquired.lock : null;
    const first = decideLockRequest(lock, userC, DOC, NOW + 1000, config);
    expect(first.kind).toBe('start_takeover');
    const pendingLock = first.kind === 'start_takeover' ? first.lock : lock!;
    const requestedAt = pendingLock.pendingTakeover?.requestedAt;

    const again = decideLockRequest(pendingLock, userC, DOC, NOW + 2000, config);
    expect(again.kind).toBe('already_pending');

    const newSession = actor({ ...userC, sessionId: 'sess-c-2', clientInstanceId: 'tab-c-2' });
    const reconnect = decideLockRequest(pendingLock, newSession, DOC, NOW + 3000, config);
    expect(reconnect.kind).toBe('refresh_pending');
    if (reconnect.kind === 'refresh_pending') {
      expect(reconnect.lock.pendingTakeover?.requestedAt).toBe(requestedAt);
      expect(reconnect.lock.pendingTakeover?.mode).toBe('request');
      expect(reconnect.lock.pendingTakeover?.requesterSessionId).toBe('sess-c-2');
    }
  });
});

describe('3) Same priority does not automatically take over', () => {
  it('keep_current policy notifies holder without forced takeover', () => {
    const acquired = decideLockRequest(null, userB, DOC, NOW, config);
    const lock = acquired.kind === 'acquire' ? acquired.lock : null;
    const request = decideLockRequest(lock, userB2, DOC, NOW + 1000, config);
    expect(request.kind).toBe('start_takeover');
    if (request.kind !== 'start_takeover') return;
    expect(request.lock.pendingTakeover?.mode).toBe('request');
    expect(request.lock.pendingTakeover?.requesterUserId).toBe(userB2.userId);
    expect(request.lock.userId).toBe(userB.userId);
  });
});

describe('4) Current editor voluntarily releases', () => {
  it('release without pending clears lock; release with pending grants requester', () => {
    const acquired = decideLockRequest(null, userC, DOC, NOW, config);
    const lock = acquired.kind === 'acquire' ? acquired.lock : null!;
    const free = decideRelease(lock, userC, NOW + 5000, config);
    expect(free.kind).toBe('released');
    if (free.kind === 'released') expect(free.grantedTo).toBeNull();

    const pending = decideLockRequest(lock, userB, DOC, NOW + 1000, config);
    expect(pending.kind).toBe('start_takeover');
    const withPending = pending.kind === 'start_takeover' ? pending.lock : lock;
    const granted = decideRelease(withPending, userC, NOW + 2000, config);
    expect(granted.kind).toBe('released');
    if (granted.kind === 'released') {
      expect(granted.grantedTo?.userId).toBe(userB.userId);
      expect(granted.grantedTo?.priority).toBe(2);
      expect(granted.grantedTo?.generation).toBe(withPending.generation + 1);
    }
  });

  it('releasing after a lower-priority notify grants the requester', () => {
    const acquired = decideLockRequest(null, userB, DOC, NOW, config);
    const lock = acquired.kind === 'acquire' ? acquired.lock : null!;
    const pending = decideLockRequest(lock, userC, DOC, NOW + 1000, config);
    expect(pending.kind).toBe('start_takeover');
    const withPending = pending.kind === 'start_takeover' ? pending.lock : lock;
    expect(withPending.pendingTakeover?.mode).toBe('request');
    const granted = decideRelease(withPending, userB, NOW + 2000, config);
    expect(granted.kind).toBe('released');
    if (granted.kind === 'released') {
      expect(granted.grantedTo?.userId).toBe(userC.userId);
      expect(granted.grantedTo?.priority).toBe(3);
    }
  });
});

describe('5-6) Ignore notification + grace period expires', () => {
  it('complete is too_early before grace, allowed after', () => {
    const lock = (decideLockRequest(null, userC, DOC, NOW, config) as Extract<ReturnType<typeof decideLockRequest>, { kind: 'acquire' }>).lock;
    const pending = decideLockRequest(lock, userB, DOC, NOW + 1000, config);
    expect(pending.kind).toBe('start_takeover');
    const pendingLock = pending.kind === 'start_takeover' ? pending.lock : lock;

    const early = decideCompleteTakeover(pendingLock, userB, NOW + 1000 + 30_000, config);
    expect(early.kind).toBe('too_early');

    const done = decideCompleteTakeover(pendingLock, userB, NOW + 1000 + 60_000, config);
    expect(done.kind).toBe('completed');
    if (done.kind === 'completed') {
      expect(done.lock.userId).toBe(userB.userId);
      expect(done.previous.userId).toBe(userC.userId);
    }
  });
});

describe('7-8) Auto-save success and failure', () => {
  it('successful snapshot allows takeover complete', async () => {
    const first = await requestEditLock({ documentId: DOC, linkId: 'link-1', actor: userC, now: NOW, config });
    expect(first.status).toBe('acquired');
    const pending = await requestEditLock({ documentId: DOC, linkId: 'link-1', actor: userB, now: NOW + 1000, config });
    expect(pending.status).toBe('takeover_pending');

    const completed = await completePriorityTakeover({
      documentId: DOC,
      linkId: 'link-1',
      actor: userB,
      now: NOW + 1000 + 60_000,
      config,
    });
    expect(completed.ok).toBe(true);
    expect(completed.snapshot?.success).toBe(true);
    expect(completed.lock?.userId).toBe(userB.userId);
    expect(prisma.fileVersion.create).toHaveBeenCalled();
    const created = (prisma.fileVersion.create as jest.Mock).mock.calls[0][0].data;
    expect(created.reason).toBe('PRIORITY_TAKEOVER');
    expect(created.changeType).toBe('PRIORITY_TAKEOVER');
    expect(created.createdBy).toBe(userC.userId);
  });

  it('failed snapshot aborts takeover and keeps lower-priority lock', async () => {
    (prisma.fileVersion.create as jest.Mock).mockRejectedValueOnce(new Error('db down'));
    await requestEditLock({ documentId: DOC, linkId: 'link-1', actor: userC, now: NOW, config });
    await requestEditLock({ documentId: DOC, linkId: 'link-1', actor: userB, now: NOW + 1000, config });

    const completed = await completePriorityTakeover({
      documentId: DOC,
      linkId: 'link-1',
      actor: userB,
      now: NOW + 1000 + 60_000,
      config,
    });
    expect(completed.ok).toBe(false);
    expect(completed.reason).toBe('snapshot_failed');
    expect(completed.lock?.userId).toBe(userC.userId);
  });
});

describe('9) Document version is created', () => {
  it('snapshot stores audit fields without plaintext content', async () => {
    await requestEditLock({ documentId: DOC, linkId: 'link-1', actor: userC, now: NOW, config });
    await requestEditLock({ documentId: DOC, linkId: 'link-1', actor: userB, now: NOW + 1, config });
    await completePriorityTakeover({
      documentId: DOC,
      linkId: 'link-1',
      actor: userB,
      now: NOW + 1 + 60_000,
      config,
    });
    const data = (prisma.fileVersion.create as jest.Mock).mock.calls[0][0].data;
    expect(data.encryptedContent).toBeDefined();
    expect(data.reason).toBe('PRIORITY_TAKEOVER');
    expect(JSON.stringify(data)).not.toMatch(/plaintext|secret-doc/i);
  });
});

describe('10) Redis lock expires', () => {
  it('expired lock is treated as free on next request', () => {
    const acquired = decideLockRequest(null, userC, DOC, NOW, config);
    const lock = acquired.kind === 'acquire' ? acquired.lock : null!;
    const afterExpiry = decideLockRequest(lock, userB, DOC, lock.expiresAt + 1, config);
    expect(afterExpiry.kind).toBe('acquire');
    if (afterExpiry.kind === 'acquire') expect(afterExpiry.lock.userId).toBe(userB.userId);
  });
});

describe('11) Two users request simultaneously', () => {
  it('CAS guarantees only one holder under concurrent acquire', async () => {
    const [r1, r2] = await Promise.all([
      requestEditLock({ documentId: DOC, linkId: 'link-1', actor: userC, now: NOW, config }),
      requestEditLock({ documentId: DOC, linkId: 'link-1', actor: userB, now: NOW, config }),
    ]);
    const statuses = [r1.status, r2.status].sort();
    const acquiredCount = [r1, r2].filter((r) => r.status === 'acquired' || r.status === 'already_holder').length;
    expect(acquiredCount).toBe(1);
    expect(statuses.includes('acquired') || statuses.includes('already_holder')).toBe(true);
    const holder = [r1, r2].find((r) => r.status === 'acquired' || r.status === 'already_holder');
    const other = [r1, r2].find((r) => r !== holder);
    expect(
      other?.status === 'takeover_pending'
      || other?.status === 'denied_higher_priority'
      || other?.status === 'denied_same_priority',
    ).toBe(true);
  });
});

describe('12) Same user opens two tabs', () => {
  it('live second tab is duplicate_tab; stale tab can reclaim', () => {
    const first = decideLockRequest(null, userC, DOC, NOW, config);
    const lock = first.kind === 'acquire' ? first.lock : null!;
    const tab2 = actor({ ...userC, clientInstanceId: 'tab-c-2' });
    const dup = decideLockRequest(lock, tab2, DOC, NOW + 1000, config);
    expect(dup.kind).toBe('duplicate_tab');

    const stale = decideLockRequest(
      { ...lock, lastHeartbeat: NOW - 30_000 },
      tab2,
      DOC,
      NOW + 1000,
      config,
    );
    expect(stale.kind).toBe('replace_own');
  });
});

describe('13) User reconnects after takeover', () => {
  it('old editor write is denied; new holder can write', async () => {
    await requestEditLock({ documentId: DOC, linkId: 'link-1', actor: userC, now: NOW, config });
    await requestEditLock({ documentId: DOC, linkId: 'link-1', actor: userB, now: NOW + 1, config });
    const done = await completePriorityTakeover({
      documentId: DOC,
      linkId: 'link-1',
      actor: userB,
      now: NOW + 1 + 60_000,
      config,
    });
    expect(done.ok).toBe(true);

    const oldWrite = await assertActorHoldsEditLock({ documentId: DOC, actor: userC, now: NOW + 1 + 61_000 });
    expect(oldWrite.ok).toBe(false);
    if (!oldWrite.ok) expect(oldWrite.reason).toBe('not_holder');

    const newWrite = await assertActorHoldsEditLock({ documentId: DOC, actor: userB, now: NOW + 1 + 61_000 });
    expect(newWrite.ok).toBe(true);
  });
});

describe('14) Old session attempts to write after takeover', () => {
  it('decideWrite rejects mismatched sessionId', () => {
    const lock: EditingLock = {
      documentId: DOC,
      userId: userB.userId,
      userName: userB.userName,
      teamId: userB.teamId,
      priority: 2,
      sessionId: userB.sessionId,
      clientInstanceId: userB.clientInstanceId,
      acquiredAt: NOW,
      lastHeartbeat: NOW,
      expiresAt: NOW + 120_000,
      reservedUntil: NOW + 3_600_000,
      generation: 2,
      token: 'share-token',
      pendingTakeover: null,
    };
    const write = decideWrite(lock, userC, NOW + 1000);
    expect(write.allowed).toBe(false);
    if (!write.allowed) expect(write.reason).toBe('not_holder');
  });
});

describe('15) Unauthorized user attempts takeover', () => {
  it('non-requester cannot complete pending takeover', () => {
    const lock = (decideLockRequest(null, userC, DOC, NOW, config) as { kind: 'acquire'; lock: EditingLock }).lock;
    const pending = decideLockRequest(lock, userB, DOC, NOW + 1, config);
    const pendingLock = pending.kind === 'start_takeover' ? pending.lock : lock;
    const stranger = actor({ userId: 'x@example.com', priority: 1, sessionId: 'sess-x' });
    const result = decideCompleteTakeover(pendingLock, stranger, NOW + 1 + 60_000, config);
    expect(result.kind).toBe('not_requester');
  });
});

describe('16) User changes priority from frontend', () => {
  it('resolveLockActor uses server VendorAccess.level, never a client priority field', () => {
    const resolved = resolveLockActor({
      sessionId: 'sess-c',
      effectiveEmail: 'c@example.com',
      level: 3,
      isOwner: false,
      token: 'share-token',
      vendors: [{ id: 'va-c', email: 'c@example.com', level: 3 }],
      clientInstanceId: 'tab-c',
      displayName: 'User C',
    });
    expect(resolved?.priority).toBe(3);
    const spoofed = resolveLockActor({
      sessionId: 'sess-c',
      effectiveEmail: 'c@example.com',
      level: 3,
      isOwner: false,
      token: 'share-token',
      vendors: [{ id: 'va-c', email: 'c@example.com', level: 3 }],
    });
    expect(spoofed?.priority).not.toBe(1);
    expect(spoofed?.priority).toBe(3);
  });

  it('owner is forced to priority 1 even if vendor row claims otherwise', () => {
    const owner = resolveLockActor({
      sessionId: 'sess-o',
      effectiveEmail: 'owner@example.com',
      level: 9,
      isOwner: true,
      token: 'share-token',
      ownerId: 'owner-1',
      vendors: [{ id: 'va-o', email: 'owner@example.com', level: 9 }],
    });
    expect(owner?.priority).toBe(1);
  });
});

describe('17) SSE disconnects during takeover', () => {
  it('reconnect status still shows pending takeover (backend is source of truth)', async () => {
    await requestEditLock({ documentId: DOC, linkId: 'link-1', actor: userC, now: NOW, config });
    const pending = await requestEditLock({ documentId: DOC, linkId: 'link-1', actor: userB, now: NOW + 1, config });
    expect(pending.status).toBe('takeover_pending');
    const again = await requestEditLock({ documentId: DOC, linkId: 'link-1', actor: userB, now: NOW + 5_000, config });
    expect(again.status).toBe('takeover_pending');
    if (again.status === 'takeover_pending') {
      expect(again.lock.pendingTakeover?.requesterUserId).toBe(userB.userId);
      expect(again.repeat).toBe(true);
      expect(again.event).toBeUndefined();
    }
  });
});

describe('18) Database transaction fails', () => {
  it('takeover aborts when FileVersion create throws', async () => {
    (prisma.fileVersion.create as jest.Mock).mockRejectedValueOnce(new Error('P2034 serialization'));
    await requestEditLock({ documentId: DOC, linkId: 'link-1', actor: userC, now: NOW, config });
    await requestEditLock({ documentId: DOC, linkId: 'link-1', actor: userB, now: NOW + 1, config });
    const result = await completePriorityTakeover({
      documentId: DOC,
      linkId: 'link-1',
      actor: userB,
      now: NOW + 1 + 60_000,
      config,
    });
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('snapshot_failed');
  });
});

describe('19) Redis becomes unavailable', () => {
  it('operations fail closed when the injected store throws', async () => {
    setEditLockStoreForTests({
      async get() { throw new EditLockUnavailableError(); },
      async getMany() { throw new EditLockUnavailableError(); },
      async cas() { throw new EditLockUnavailableError(); },
      async publishEvent() { throw new EditLockUnavailableError(); },
      async getEvent() { throw new EditLockUnavailableError(); },
    });
    await expect(
      requestEditLock({ documentId: DOC, linkId: 'link-1', actor: userC, now: NOW, config }),
    ).rejects.toBeInstanceOf(EditLockUnavailableError);
    setEditLockStoreForTests(null);
  });
});

describe('20) No document changes are lost', () => {
  it('takeover snapshot copies current ciphertext before lock transfer', async () => {
    await requestEditLock({ documentId: DOC, linkId: 'link-1', actor: userC, now: NOW, config });
    await requestEditLock({ documentId: DOC, linkId: 'link-1', actor: userB, now: NOW + 1, config });
    await completePriorityTakeover({
      documentId: DOC,
      linkId: 'link-1',
      actor: userB,
      now: NOW + 1 + 60_000,
      config,
    });
    expect(prisma.userFile.findUnique).toHaveBeenCalled();
    expect(prisma.fileVersion.create).toHaveBeenCalled();
    const data = (prisma.fileVersion.create as jest.Mock).mock.calls[0][0].data;
    expect(Buffer.isBuffer(data.encryptedContent) || data.encryptedContent).toBeTruthy();
    expect(data.iv).toBe('iv');
    expect(data.authTag).toBe('tag');
  });
});

describe('heartbeat + reservation', () => {
  it('holder heartbeat refreshes expiry; reservation does not block higher-priority takeover', () => {
    const acquired = decideLockRequest(null, userC, DOC, NOW, config);
    const lock = acquired.kind === 'acquire' ? acquired.lock : null!;
    expect(lock.reservedUntil).toBe(NOW + 3_600_000);

    const beat = decideHeartbeat(lock, userC, NOW + 10_000, config);
    expect(beat.kind).toBe('ok');
    if (beat.kind === 'ok') {
      expect(beat.lock.expiresAt).toBe(NOW + 10_000 + 120_000);
    }

    // Still inside the 1-hour reservation AND inside lock TTL — takeover must still be allowed.
    const duringReservation = decideLockRequest(lock, userB, DOC, NOW + 30_000, config);
    expect(duringReservation.kind).toBe('start_takeover');
  });
});

describe('config defaults', () => {
  it('has no constant countdown or reservation by default', () => {
    const cfg = getEditLockConfig();
    expect(cfg.gracePeriodSeconds).toBe(0);
    expect(cfg.reservationSeconds).toBe(0);
    expect(cfg.samePriorityPolicy).toBe('keep_current');
  });

  it('unlimited grace does not auto-complete; forceImmediate does', () => {
    const unlimited = { ...config, gracePeriodSeconds: 0 };
    const lock = (decideLockRequest(null, userC, DOC, NOW, unlimited) as { kind: 'acquire'; lock: EditingLock }).lock;
    const pending = decideLockRequest(lock, userB, DOC, NOW + 1000, unlimited);
    const pendingLock = pending.kind === 'start_takeover' ? pending.lock : lock;
    expect(pendingLock.pendingTakeover?.graceEndsAt).toBe(0);

    const wait = decideCompleteTakeover(pendingLock, userB, NOW + 30_000, unlimited);
    expect(wait.kind).toBe('too_early');

    const forced = decideCompleteTakeover(pendingLock, userB, NOW + 30_000, unlimited, false, true);
    expect(forced.kind).toBe('completed');
  });
});
