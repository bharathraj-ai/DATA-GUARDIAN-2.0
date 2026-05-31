import { revokeAccess } from '../src/actions/revoke-access';
import { prisma } from '../src/lib/prisma';
import { logger } from '../src/lib/logger';
import assert from 'node:assert/strict';

// Mock the auth module to control the session dynamically
jest.mock('@/lib/auth', () => ({
    auth: jest.fn(),
}));

import { auth } from '@/lib/auth';

const mockedAuth = auth as jest.MockedFunction<typeof auth>;

// Helper to suppress expected error logs during tests
const originalConsoleError = console.error;
const originalLoggerError = logger.error;
const originalLoggerWarn = logger.warn;

async function setupTestData() {
    const ownerId = 'user_owner_123';
    const vendorId = 'user_vendor_456';
    const ownerToken = 'token_owner_test_789';

    // Ensure we start clean
    await prisma.secureLink.deleteMany({
        where: { ownerToken }
    }).catch(() => {});
    
    await prisma.userData.deleteMany({
        where: { encryptedData: 'test_encrypted_data' }
    }).catch(() => {});

    // Create a mock UserData and SecureLink
    const userData = await prisma.userData.create({
        data: {
            encryptedData: 'test_encrypted_data',
            dataHash: 'test_hash'
        }
    });

    const secureLink = await prisma.secureLink.create({
        data: {
            token: 'test_token_revoke',
            ownerToken: ownerToken,
            otpHash: 'test_otp_hash',
            expiresAt: new Date(Date.now() + 1000000),
            ownerId: ownerId,
            userId: userData.id,
        }
    });

    return { ownerId, vendorId, ownerToken, secureLinkId: secureLink.id };
}

async function runTests() {
    console.log('--- Running Revoke Access BOLA Tests ---');
    let data;

    try {
        data = await setupTestData();
    } catch (err) {
        console.error('Failed to setup test data. Make sure local DB is running.', err);
        process.exit(1);
    }

    try {
        // Suppress expected errors
        console.error = () => {};
        logger.error = () => {};
        logger.warn = () => {};

        // TEST 1: Anonymous fails
        console.log('Test 1: Anonymous user fails to revoke');
        mockedAuth.mockResolvedValueOnce(null);
        let res = await revokeAccess(data.ownerToken);
        assert.equal(res.success, false);
        assert.match(res.error || '', /Authentication required/);

        // TEST 2: Vendor (unauthorized user) fails
        console.log('Test 2: Vendor (unauthorized user) fails to revoke');
        mockedAuth.mockResolvedValueOnce({ user: { id: data.vendorId } } as any);
        res = await revokeAccess(data.ownerToken);
        assert.equal(res.success, false);
        assert.match(res.error || '', /Unauthorized/);

        // Verify audit log for unauthorized access
        const auditLog = await prisma.auditLog.findFirst({
            where: { linkId: data.secureLinkId, action: 'REVOKE_ACCESS_DENIED' },
            orderBy: { timestamp: 'desc' }
        });
        assert.ok(auditLog, 'REVOKE_ACCESS_DENIED audit log should be created');

        // TEST 3: Invalid token fails
        console.log('Test 3: Invalid token fails safely');
        mockedAuth.mockResolvedValueOnce({ user: { id: data.ownerId } } as any);
        res = await revokeAccess('invalid_token_123');
        assert.equal(res.success, false);
        assert.match(res.error || '', /Invalid owner token/);

        // TEST 4: Owner succeeds
        console.log('Test 4: Owner successfully revokes');
        mockedAuth.mockResolvedValueOnce({ user: { id: data.ownerId } } as any);
        res = await revokeAccess(data.ownerToken);
        assert.equal(res.success, true);

        // Verify audit log for successful revocation
        const successLog = await prisma.auditLog.findFirst({
            where: { linkId: data.secureLinkId, action: 'REVOKE_ACCESS_SUCCESS' },
            orderBy: { timestamp: 'desc' }
        });
        assert.ok(successLog, 'REVOKE_ACCESS_SUCCESS audit log should be created');

        // Verify link is actually revoked in DB
        const revokedLink = await prisma.secureLink.findUnique({
            where: { id: data.secureLinkId }
        });
        assert.equal(revokedLink?.isRevoked, true);

        console.log('✅ All tests passed successfully!');

    } catch (err) {
        console.error('❌ Test failed:', err);
        process.exit(1);
    } finally {
        // Restore console/logger
        console.error = originalConsoleError;
        logger.error = originalLoggerError;
        logger.warn = originalLoggerWarn;

        // Cleanup
        if (data) {
            await prisma.secureLink.delete({ where: { id: data.secureLinkId } }).catch(() => {});
            await prisma.auditLog.deleteMany({ where: { linkId: data.secureLinkId } }).catch(() => {});
        }
    }
}

runTests();
