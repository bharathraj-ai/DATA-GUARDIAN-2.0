/**
 * Tests for Vendor Complete Work flow:
 * Ensuring completing work does NOT trigger suspicious activity or false-positive revocation screens.
 */

process.env.ENCRYPTION_KEY =
    process.env.ENCRYPTION_KEY ||
    '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
process.env.SESSION_HMAC_SECRET =
    process.env.SESSION_HMAC_SECRET || 'test-session-hmac-secret-min-32-chars!!';
process.env.OTP_HMAC_SECRET =
    process.env.OTP_HMAC_SECRET || 'test-otp-hmac-secret-min-32-chars!!!!';
process.env.UPSTASH_REDIS_REST_URL = '';
process.env.UPSTASH_REDIS_REST_TOKEN = '';

const mockFindUnique = jest.fn();
jest.mock('@/lib/prisma', () => ({
    prisma: {
        secureLink: {
            findUnique: (...args: unknown[]) => mockFindUnique(...args),
        },
        vendorAccess: {
            findUnique: jest.fn(),
            updateMany: jest.fn(),
        },
        auditLog: {
            create: jest.fn(),
        },
    },
}));

jest.mock('@/lib/linkAuthorization', () => ({
    authorizeSecureLink: jest.fn().mockImplementation(async (token: string) => {
        // When link is revoked
        return {
            success: false,
            status: 403,
            error: 'Forbidden: Link has expired or been revoked',
        };
    }),
}));

import {
    markWorkCompleted,
    isWorkCompleted,
    isInternalNavigationActive,
} from '@/components/view/sudden-exit-client';
import { getUserData } from '@/actions/get-user';

describe('Vendor Complete Work State & Security Guards', () => {
    const mockStorage = new Map<string, string>();

    beforeAll(() => {
        (global as any).sessionStorage = {
            getItem: (k: string) => mockStorage.get(k) || null,
            setItem: (k: string, v: string) => mockStorage.set(k, String(v)),
            removeItem: (k: string) => mockStorage.delete(k),
            clear: () => mockStorage.clear(),
        };
        (global as any).window = global;
    });

    afterAll(() => {
        delete (global as any).sessionStorage;
        delete (global as any).window;
    });

    beforeEach(() => {
        jest.clearAllMocks();
        mockStorage.clear();
        delete (global as any).__DG_WORK_COMPLETED__;
        delete (global as any).__DG_INTERNAL_NAV__;
        delete (global as any).__DG_RELOAD__;
    });

    it('marks work completed and flags internal navigation as active', () => {
        expect(isWorkCompleted()).toBe(false);
        expect(isInternalNavigationActive()).toBe(false);

        markWorkCompleted();

        expect(isWorkCompleted()).toBe(true);
        expect(isInternalNavigationActive()).toBe(true);
    });

    it('getUserData identifies completed link and returns errorType COMPLETED instead of REVOKED', async () => {
        mockFindUnique.mockResolvedValue({
            id: 'link-completed-123',
            isRevoked: true,
            VendorAccess: [
                {
                    status: 'completed',
                },
            ],
            AuditLog: [
                {
                    id: 'audit-log-1',
                },
            ],
        });

        const result = await getUserData('completed-token-123');

        expect(result.success).toBe(false);
        expect(result.errorType).toBe('COMPLETED');
        expect(result.error).toContain('completed');
        expect(result.error).not.toContain('revoked');
    });

    it('getUserData falls back to REVOKED when link was revoked without completion', async () => {
        mockFindUnique.mockResolvedValue({
            id: 'link-revoked-123',
            isRevoked: true,
            VendorAccess: [
                {
                    status: 'active',
                },
            ],
            AuditLog: [],
        });

        const result = await getUserData('revoked-token-123');

        expect(result.success).toBe(false);
        expect(result.errorType).toBe('REVOKED');
        expect(result.error).toContain('revoked');
    });
});
