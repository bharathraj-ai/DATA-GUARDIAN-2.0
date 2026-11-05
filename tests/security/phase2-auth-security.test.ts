process.env.ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || '6e7f87c312aa5a9d1d45434ae1edbc32cf9a2b6e52a7d592eb24fce9827b8f41';
process.env.KEK_KEY = process.env.KEK_KEY || '7672891e32cf490be6f8740a1c988fb86fa605f0981e6209fbfd96a0b7ea5cd4';
process.env.OTP_HMAC_SECRET = process.env.OTP_HMAC_SECRET || 'test-otp-hmac-secret-min-32-chars-for-dev!!';
process.env.SESSION_HMAC_SECRET = process.env.SESSION_HMAC_SECRET || 'test-session-hmac-secret-min-32-chars-for-dev!!';
process.env.NEXTAUTH_SECRET = process.env.NEXTAUTH_SECRET || 'eA5TBa9rO9uMP4Sp2zLiXfRaeBXJ11kNkFbOifhbQh18=';
process.env.NEXTAUTH_URL = process.env.NEXTAUTH_URL || 'http://localhost:3000';

import { prisma } from '@/lib/prisma';
import { createRaceSafePrismaAdapter } from '@/lib/auth-adapter';
import { authOptions } from '@/lib/auth';
import { hashPassword, verifyPassword } from '@/lib/security/password';
import {
    createPasswordResetToken,
    verifyAndConsumePasswordResetToken,
} from '@/lib/security/auth-tokens';
import { isUserSessionRevoked, _clearUserSessionRevocationsForTesting } from '@/lib/security/user-session-revocation';

jest.setTimeout(30000);

describe('PHASE 2: AUTHENTICATION, IDENTITY MANAGEMENT & ACCOUNT SECURITY REGRESSION SUITE', () => {
    const adapter = createRaceSafePrismaAdapter(prisma);
    const runId = Date.now();
    const strongPassword = 'P@ssword123!Secure';
    const attackerPassword = 'Att@ckerPassword999!';

    beforeEach(() => {
        _clearUserSessionRevocationsForTesting();
    });

    afterAll(async () => {
        try {
            await prisma.account.deleteMany({
                where: { user: { email: { contains: `p2-${runId}` } } },
            });
            await prisma.passwordResetToken.deleteMany({
                where: { email: { contains: `p2-${runId}` } },
            });
            await prisma.emailVerificationToken.deleteMany({
                where: { email: { contains: `p2-${runId}` } },
            });
            await prisma.user.deleteMany({
                where: { email: { contains: `p2-${runId}` } },
            });
        } catch {
            // ignore cleanup errors
        } finally {
            await prisma.$disconnect();
        }
    });

    // ============================================================
    // 1. UNVERIFIED MANUAL ACCOUNT CONFLICT & PRE-HIJACKING DEFENSE
    // ============================================================
    describe('1. Unverified manual account conflict & pre-hijacking prevention', () => {
        const victimEmail = `p2-${runId}-victim@example.com`;

        it('sanitizes unverified manual account and destroys attacker password on Google sign-in', async () => {
            // Step A: Attacker pre-registers the victim email with manual password
            const attackerHash = await hashPassword(attackerPassword);
            const manualUser = await prisma.user.create({
                data: {
                    name: 'Victim Imposter',
                    email: victimEmail,
                    passwordHash: attackerHash,
                    authProvider: 'email',
                    role: 'VENDOR',
                    roleSelected: false,
                    emailVerified: null, // Unverified!
                },
            });

            expect(manualUser.emailVerified).toBeNull();
            expect(manualUser.passwordHash).toBe(attackerHash);

            // Step B: Verified Google OAuth sign-in initiates for this email
            // getUserByEmail must yield (return null) so verified OAuth can claim and sanitize
            const userLookup = await adapter.getUserByEmail!(victimEmail);
            expect(userLookup).toBeNull();

            // Step C: NextAuth calls createUser for the verified Google identity
            const claimedUser = await adapter.createUser({
                name: 'Legitimate Google User',
                email: victimEmail,
                emailVerified: new Date(),
                image: 'https://lh3.googleusercontent.com/photo.jpg',
            });

            expect(claimedUser.id).toBe(manualUser.id);
            expect(claimedUser.email).toBe(victimEmail);

            // Step D: Verify that attacker's password has been completely destroyed
            const sanitizedDbUser = await prisma.user.findUnique({
                where: { id: manualUser.id },
            });
            expect(sanitizedDbUser?.passwordHash).toBeNull();
            expect(sanitizedDbUser?.emailVerified).toBeInstanceOf(Date);

            // Step E: Attacker attempts to log in with their pre-registered password — MUST FAIL
            const credentialsProvider = authOptions.providers.find((p) => p.id === 'credentials') as any;
            const authorize = credentialsProvider.options?.authorize || credentialsProvider.authorize;

            await expect(
                authorize({ email: victimEmail, password: attackerPassword }, {} as any)
            ).rejects.toThrow('INVALID_CREDENTIALS');

            // Step F: Link Google Account
            const googleAccount = {
                userId: claimedUser.id,
                type: 'oauth' as const,
                provider: 'google',
                providerAccountId: `google-acc-${runId}-1`,
            };
            await adapter.linkAccount(googleAccount);

            const linkedAccount = await prisma.account.findUnique({
                where: {
                    provider_providerAccountId: {
                        provider: 'google',
                        providerAccountId: `google-acc-${runId}-1`,
                    },
                },
            });
            expect(linkedAccount).not.toBeNull();
            expect(linkedAccount?.userId).toBe(manualUser.id);
        });
    });

    // ============================================================
    // 2. EXISTING VERIFIED EMAIL CONFLICT (SAFE NON-LINKING)
    // ============================================================
    describe('2. Existing verified email conflict prevents unsafe automatic linking', () => {
        const verifiedEmail = `p2-${runId}-verified@example.com`;

        it('returns verified user in getUserByEmail and blocks automatic linking on createUser', async () => {
            const verifiedHash = await hashPassword(strongPassword);
            await prisma.user.create({
                data: {
                    name: 'Verified User',
                    email: verifiedEmail,
                    passwordHash: verifiedHash,
                    authProvider: 'email',
                    role: 'OWNER',
                    roleSelected: true,
                    emailVerified: new Date(), // Already verified by email confirmation
                },
            });

            // For verified accounts, getUserByEmail MUST return the user
            const userLookup = await adapter.getUserByEmail!(verifiedEmail);
            expect(userLookup).not.toBeNull();
            expect(userLookup?.email).toBe(verifiedEmail);
            expect(userLookup?.emailVerified).toBeInstanceOf(Date);

            // If createUser is somehow attempted for an existing verified password account,
            // it must reject with OAuthAccountNotLinked rather than silently linking
            await expect(
                adapter.createUser({
                    name: 'OAuth Infiltrator',
                    email: verifiedEmail,
                    emailVerified: new Date(),
                })
            ).rejects.toThrow('OAuthAccountNotLinked');
        });
    });

    // ============================================================
    // 3. CONCURRENT ACCOUNT REGISTRATION SAFETY
    // ============================================================
    describe('3. Concurrent account creation handles race conditions safely', () => {
        const concurrentEmail = `p2-${runId}-concurrent@example.com`;

        it('handles simultaneous createUser invocations idempotently without corrupting state', async () => {
            const userData = {
                name: 'Concurrent User',
                email: concurrentEmail,
                emailVerified: new Date(),
            };

            // Run two simultaneous creations
            const [res1, res2] = await Promise.all([
                adapter.createUser(userData),
                adapter.createUser(userData),
            ]);

            expect(res1).toBeDefined();
            expect(res2).toBeDefined();
            expect(res1.id).toBe(res2.id);
            expect(res1.email).toBe(concurrentEmail);

            // Confirm only exactly 1 user row exists in DB
            const count = await prisma.user.count({
                where: { email: concurrentEmail },
            });
            expect(count).toBe(1);
        });
    });

    // ============================================================
    // 4. GOOGLE USER WORKFLOW: FIRST-TIME LOGIN → PASSWORD SETUP → MANUAL SIGN-IN
    // ============================================================
    describe('4. Complete Google workflow without password to dual-auth capability', () => {
        const flowEmail = `p2-${runId}-flow@example.com`;
        let flowUserId: string;

        it('1) Google user created with passwordHash === null and verified email', async () => {
            const user = await adapter.createUser({
                name: 'Google Flow User',
                email: flowEmail,
                emailVerified: new Date(),
            });
            flowUserId = user.id;

            await adapter.linkAccount({
                userId: flowUserId,
                type: 'oauth',
                provider: 'google',
                providerAccountId: `g-flow-${runId}`,
            });

            const dbUser = await prisma.user.findUnique({
                where: { id: flowUserId },
            });
            expect(dbUser?.passwordHash).toBeNull();
            expect(Boolean(dbUser?.passwordHash)).toBe(false);
        });

        it('2) User establishes a strong password via atomic updateMany', async () => {
            const newPasswordHash = await hashPassword(strongPassword);

            // Atomic CAS check: where id = flowUserId and passwordHash = null
            const updated = await prisma.user.updateMany({
                where: {
                    id: flowUserId,
                    passwordHash: null,
                },
                data: {
                    passwordHash: newPasswordHash,
                    emailVerified: new Date(),
                },
            });

            expect(updated.count).toBe(1);

            const user = await prisma.user.findUnique({
                where: { id: flowUserId },
            });
            expect(user?.passwordHash).toBe(newPasswordHash);
        });

        it('3) Attempting to overwrite established password via set-password CAS is rejected', async () => {
            const imposterHash = await hashPassword('DifferentPassword123!');

            const secondAttempt = await prisma.user.updateMany({
                where: {
                    id: flowUserId,
                    passwordHash: null,
                },
                data: {
                    passwordHash: imposterHash,
                },
            });

            // Must reject (0 rows updated) because passwordHash is no longer null
            expect(secondAttempt.count).toBe(0);

            // Verify original password is still intact
            const user = await prisma.user.findUnique({
                where: { id: flowUserId },
            });
            expect(await verifyPassword(user?.passwordHash, strongPassword)).toBe(true);
        });

        it('4) User can now sign in using manual credentials with the new password', async () => {
            const credentialsProvider = authOptions.providers.find((p) => p.id === 'credentials') as any;
            const authorize = credentialsProvider.options?.authorize || credentialsProvider.authorize;

            const authResult = await authorize(
                { email: flowEmail, password: strongPassword },
                {} as any
            );

            expect(authResult).not.toBeNull();
            expect(authResult.id).toBe(flowUserId);
            expect(authResult.email).toBe(flowEmail);
            expect(authResult.hasPassword).toBe(true);
        });

        it('5) Google OAuth account remains linked and operational', async () => {
            const account = await adapter.getUserByAccount!({
                provider: 'google',
                providerAccountId: `g-flow-${runId}`,
            });

            expect(account).not.toBeNull();
            expect(account?.id).toBe(flowUserId);
        });
    });

    // ============================================================
    // 5. PASSWORD RESET & JWT SESSION REVOCATION
    // ============================================================
    describe('5. Password reset enforces single-use and revokes active sessions', () => {
        const resetEmail = `p2-${runId}-reset@example.com`;
        let resetUserId: string;

        beforeAll(async () => {
            const u = await prisma.user.create({
                data: {
                    name: 'Reset Test User',
                    email: resetEmail,
                    passwordHash: await hashPassword(strongPassword),
                    authProvider: 'email',
                    emailVerified: new Date(),
                },
            });
            resetUserId = u.id;
        });

        it('resets password, consumes token single-use, and invalidates active JWT sessions', async () => {
            const token = await createPasswordResetToken(resetEmail);
            expect(token).not.toBeNull();

            // Simulate an active JWT issued 10 seconds ago
            const activeTokenIssuedAt = Math.floor(Date.now() / 1000) - 10;
            expect(await isUserSessionRevoked(resetUserId, activeTokenIssuedAt)).toBe(false);

            // Execute password reset
            const updatedPassword = 'NewResetP@ssword2026!';
            const resetResult = await verifyAndConsumePasswordResetToken(token!, updatedPassword);
            expect(resetResult.success).toBe(true);

            // Active JWT issued before password reset MUST NOW BE REVOKED
            const isRevoked = await isUserSessionRevoked(resetUserId, activeTokenIssuedAt);
            expect(isRevoked).toBe(true);

            // A new JWT issued AFTER password reset must be valid
            const newTokenIssuedAt = Math.floor(Date.now() / 1000) + 1;
            expect(await isUserSessionRevoked(resetUserId, newTokenIssuedAt)).toBe(false);

            // Reusing the same reset token MUST FAIL (single-use enforcement)
            const replayResult = await verifyAndConsumePasswordResetToken(token!, 'AnotherP@ssword999!');
            expect(replayResult.success).toBe(false);

            // User can now log in with the new password
            const credentialsProvider = authOptions.providers.find((p) => p.id === 'credentials') as any;
            const authorize = credentialsProvider.options?.authorize || credentialsProvider.authorize;

            const authResult = await authorize(
                { email: resetEmail, password: updatedPassword },
                {} as any
            );
            expect(authResult.id).toBe(resetUserId);
        });
    });
});

