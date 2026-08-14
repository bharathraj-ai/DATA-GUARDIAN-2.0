/**
 * Suspicious screenshot → kill-switch: revoke link, notify owner, no restore.
 */

process.env.ENCRYPTION_KEY =
    process.env.ENCRYPTION_KEY ||
    '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
process.env.SESSION_HMAC_SECRET =
    process.env.SESSION_HMAC_SECRET || 'test-session-hmac-secret-min-32-chars!!';
process.env.UPSTASH_REDIS_REST_URL = '';
process.env.UPSTASH_REDIS_REST_TOKEN = '';

const mockUpdateMany = jest.fn();
const mockAuditCreate = jest.fn();
const mockFindUnique = jest.fn();
const mockTransaction = jest.fn();

jest.mock('@/lib/prisma', () => ({
    prisma: {
        secureLink: {
            findUnique: (...args: unknown[]) => mockFindUnique(...args),
            updateMany: (...args: unknown[]) => mockUpdateMany(...args),
        },
        vendorAccess: {
            updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        },
        auditLog: {
            create: (...args: unknown[]) => mockAuditCreate(...args),
        },
        $transaction: (...args: unknown[]) => mockTransaction(...args),
    },
}));

import {
    isAllowedSuspiciousReason,
    revokeForSuspiciousActivity,
} from '@/lib/revoke-suspicious-activity';
import { prisma } from '@/lib/prisma';

describe('isAllowedSuspiciousReason', () => {
    it('accepts screenshot, devtools, tab_switch, and copy', () => {
        expect(isAllowedSuspiciousReason('screenshot')).toBe(true);
        expect(isAllowedSuspiciousReason('devtools')).toBe(true);
        expect(isAllowedSuspiciousReason('tab_switch')).toBe(true);
        expect(isAllowedSuspiciousReason('copy')).toBe(true);
        expect(isAllowedSuspiciousReason('printscreen')).toBe(false);
        expect(isAllowedSuspiciousReason('focus-lost')).toBe(false);
        expect(isAllowedSuspiciousReason('')).toBe(false);
        expect(isAllowedSuspiciousReason(null)).toBe(false);
    });
});

describe('revokeForSuspiciousActivity', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mockTransaction.mockImplementation(async (fn: (tx: typeof prisma) => unknown) => fn(prisma));
        mockUpdateMany.mockResolvedValue({ count: 1 });
        mockAuditCreate.mockResolvedValue({ id: 'audit-1' });
        (prisma.vendorAccess.updateMany as jest.Mock).mockResolvedValue({ count: 1 });
    });

    it('revokes the link and returns owner notify payload', async () => {
        mockFindUnique.mockResolvedValue({
            id: 'link-1',
            token: 'share-token',
            ownerId: 'owner-1',
            isRevoked: false,
            notificationEmail: 'owner@example.com',
            User: { email: 'owner@example.com' },
        });

        const result = await revokeForSuspiciousActivity({
            token: 'share-token',
            reason: 'screenshot',
            vendorEmail: 'vendor@example.com',
            sessionId: 'session-abc-123456',
        });

        expect(result.success).toBe(true);
        expect(result.alreadyRevoked).toBeUndefined();
        expect(result.tokenToPurge).toBe('share-token');
        expect(result.notify).toEqual({
            email: 'owner@example.com',
            linkId: 'link-1',
            vendorEmail: 'vendor@example.com',
            reason: 'screenshot',
        });
        expect(mockUpdateMany).toHaveBeenCalledWith({
            where: { id: 'link-1', isRevoked: false },
            data: { isRevoked: true },
        });
        expect(prisma.vendorAccess.updateMany).toHaveBeenCalledWith(
            expect.objectContaining({
                where: { secureLinkId: 'link-1' },
                data: expect.objectContaining({ isRevoked: true }),
            }),
        );
        expect(mockAuditCreate).toHaveBeenCalledWith(
            expect.objectContaining({
                data: expect.objectContaining({
                    action: 'SUSPICIOUS_ACTIVITY_REVOKE',
                    ownerId: 'owner-1',
                }),
            }),
        );
    });

    it('is idempotent when the link is already revoked', async () => {
        mockFindUnique.mockResolvedValue({
            id: 'link-1',
            token: 'share-token',
            ownerId: 'owner-1',
            isRevoked: true,
            notificationEmail: 'owner@example.com',
            User: null,
        });

        const result = await revokeForSuspiciousActivity({
            token: 'share-token',
            reason: 'screenshot',
            vendorEmail: 'vendor@example.com',
            sessionId: 'session-abc-123456',
        });

        expect(result).toEqual({ success: true, alreadyRevoked: true });
        expect(mockTransaction).not.toHaveBeenCalled();
        expect(result.notify).toBeUndefined();
    });

    it('does not double-notify when a concurrent revoke already claimed the row', async () => {
        mockFindUnique.mockResolvedValue({
            id: 'link-1',
            token: 'share-token',
            ownerId: 'owner-1',
            isRevoked: false,
            notificationEmail: 'owner@example.com',
            User: null,
        });
        mockUpdateMany.mockResolvedValue({ count: 0 });

        const result = await revokeForSuspiciousActivity({
            token: 'share-token',
            reason: 'screenshot',
            vendorEmail: 'vendor@example.com',
            sessionId: 'session-abc-123456',
        });

        expect(result).toEqual({ success: true, alreadyRevoked: true });
        expect(mockAuditCreate).not.toHaveBeenCalled();
    });

    it('falls back to owner account email when notificationEmail is missing', async () => {
        mockFindUnique.mockResolvedValue({
            id: 'link-1',
            token: 'share-token',
            ownerId: 'owner-1',
            isRevoked: false,
            notificationEmail: null,
            User: { email: 'account@example.com' },
        });

        const result = await revokeForSuspiciousActivity({
            token: 'share-token',
            reason: 'screenshot',
            vendorEmail: null,
            sessionId: 'session-abc-123456',
        });

        expect(result.notify?.email).toBe('account@example.com');
    });
});
