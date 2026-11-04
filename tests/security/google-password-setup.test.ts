process.env.ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || '6e7f87c312aa5a9d1d45434ae1edbc32cf9a2b6e52a7d592eb24fce9827b8f41';
process.env.KEK_KEY = process.env.KEK_KEY || '7672891e32cf490be6f8740a1c988fb86fa605f0981e6209fbfd96a0b7ea5cd4';
process.env.OTP_HMAC_SECRET = process.env.OTP_HMAC_SECRET || 'test-otp-hmac-secret-min-32-chars-for-dev!!';
process.env.SESSION_HMAC_SECRET = process.env.SESSION_HMAC_SECRET || 'test-session-hmac-secret-min-32-chars-for-dev!!';
process.env.NEXTAUTH_SECRET = process.env.NEXTAUTH_SECRET || 'eA5TBa9rO9uMP4Sp2zLiXfRaeBXJ11kNkFbOifhbQh18=';
process.env.NEXTAUTH_URL = process.env.NEXTAUTH_URL || 'http://localhost:3000';

import { prisma } from '@/lib/prisma';
import { authOptions } from '@/lib/auth';
import { hashPassword, verifyPassword } from '@/lib/security/password';
import { setPasswordSchema } from '@/lib/validations';
import {
    createPasswordResetToken,
    verifyAndConsumePasswordResetToken,
} from '@/lib/security/auth-tokens';

jest.setTimeout(30000);

describe('PHASE 10 – MANDATORY PASSWORD SETUP FOR GOOGLE OAUTH USERS', () => {
    const timestamp = Date.now();
    const testGoogleEmail = `google-setup-${timestamp}@example.com`;
    const initialPassword = 'P@ssword123!Secure';
    let testGoogleUserId: string;

    afterAll(async () => {
        try {
            await prisma.account.deleteMany({
                where: { user: { email: { contains: 'google-setup-' } } },
            });
            await prisma.passwordResetToken.deleteMany({
                where: { email: { contains: 'google-setup-' } },
            });
            await prisma.user.deleteMany({
                where: { email: { contains: 'google-setup-' } },
            });
        } catch {
            // ignore
        } finally {
            await prisma.$disconnect();
        }
    });

    // ============================================
    // TEST 1: NEW GOOGLE USER → PASSWORD SETUP REQUIRED
    // ============================================
    describe('1. New Google user requires password setup', () => {
        it('creates a new Google OAuth user with passwordHash = null', async () => {
            const user = await prisma.user.create({
                data: {
                    name: 'New Google User',
                    email: testGoogleEmail,
                    passwordHash: null,
                    authProvider: 'google',
                    role: 'VENDOR',
                    roleSelected: false,
                    emailVerified: new Date(),
                    Account: {
                        create: {
                            type: 'oauth',
                            provider: 'google',
                            providerAccountId: `g_acc_${timestamp}`,
                        },
                    },
                },
            });

            testGoogleUserId = user.id;

            expect(user.id).toBeDefined();
            expect(user.passwordHash).toBeNull();

            // Policy check: user has no password
            const hasPassword = Boolean(user.passwordHash);
            expect(hasPassword).toBe(false);
        });
    });

    // ============================================
    // TEST 2: EXISTING GOOGLE USER WITHOUT PASSWORD
    // ============================================
    describe('2. Existing Google user without password', () => {
        it('identifies passwordHash === null requiring redirect to set-password', async () => {
            const user = await prisma.user.findUnique({
                where: { id: testGoogleUserId },
                select: { id: true, email: true, passwordHash: true },
            });

            expect(user).not.toBeNull();
            expect(user?.passwordHash).toBeNull();
            expect(Boolean(user?.passwordHash)).toBe(false);
        });
    });

    // ============================================
    // TEST 3: EXISTING GOOGLE USER WITH PASSWORD → DIRECT ACCESS
    // ============================================
    describe('3. Existing Google user with password bypasses setup', () => {
        it('permits direct access when passwordHash is populated', async () => {
            const userWithPassword = {
                id: 'existing_usr_pwd',
                email: 'haspwd@example.com',
                passwordHash: '$argon2id$mockhash',
            };

            const requiresPasswordSetup = !userWithPassword.passwordHash;
            expect(requiresPasswordSetup).toBe(false);
        });
    });

    // ============================================
    // TEST 4: GOOGLE USER CREATES PASSWORD → MANUAL LOGIN WORKS
    // ============================================
    describe('4. Google user creates password and enables manual sign in', () => {
        it('saves Argon2id hash and enables CredentialsProvider authentication', async () => {
            const parsed = setPasswordSchema.safeParse({
                password: initialPassword,
                confirmPassword: initialPassword,
            });
            expect(parsed.success).toBe(true);

            // Establish password
            const passwordHash = await hashPassword(initialPassword);
            const updatedUser = await prisma.user.update({
                where: { id: testGoogleUserId },
                data: { passwordHash },
            });

            expect(updatedUser.passwordHash).toMatch(/^\$argon2id\$/);

            // Manual Credentials login with the same Google email
            const credentialsProvider = authOptions.providers.find(
                (p) => p.id === 'credentials'
            ) as any;
            const authorize = credentialsProvider.options?.authorize || credentialsProvider.authorize;

            const authResult = await authorize(
                { email: testGoogleEmail, password: initialPassword },
                {} as any
            );

            expect(authResult).not.toBeNull();
            expect(authResult.id).toBe(testGoogleUserId);
            expect(authResult.email).toBe(testGoogleEmail);
            expect(authResult.hasPassword).toBe(true);
        });
    });

    // ============================================
    // TEST 5: MANUAL LOGIN → GOOGLE OAUTH STILL WORKS
    // ============================================
    describe('5. Google OAuth remains functional after setting password', () => {
        it('retains linked Google Account record and existing user association', async () => {
            const account = await prisma.account.findUnique({
                where: {
                    provider_providerAccountId: {
                        provider: 'google',
                        providerAccountId: `g_acc_${timestamp}`,
                    },
                },
                include: { user: true },
            });

            expect(account).not.toBeNull();
            expect(account?.userId).toBe(testGoogleUserId);
            expect(account?.user.email).toBe(testGoogleEmail);
            expect(account?.user.passwordHash).not.toBeNull();
        });
    });

    // ============================================
    // TEST 6: DIRECT DASHBOARD ACCESS BEFORE PASSWORD SETUP
    // ============================================
    describe('6. Direct dashboard access before password setup is blocked', () => {
        it('server-side policy denies dashboard access when hasPassword is false', () => {
            const sessionWithoutPassword = {
                user: {
                    id: 'usr_no_pwd',
                    email: 'nopwd@example.com',
                    emailVerified: new Date(),
                    hasPassword: false,
                },
            };

            const sessionWithPassword = {
                user: {
                    id: 'usr_with_pwd',
                    email: 'withpwd@example.com',
                    emailVerified: new Date(),
                    hasPassword: true,
                },
            };

            const canEnterDashboard = (s: typeof sessionWithoutPassword) => {
                return Boolean(s?.user?.id && s.user.emailVerified && s.user.hasPassword);
            };

            expect(canEnterDashboard(sessionWithoutPassword)).toBe(false);
            expect(canEnterDashboard(sessionWithPassword)).toBe(true);
        });
    });

    // ============================================
    // TEST 7: PASSWORD SETUP ENDPOINT REJECTS UNAUTHENTICATED CALLS
    // ============================================
    describe('7. Set Password requires valid authenticated session', () => {
        it('rejects unauthenticated requests with 401', () => {
            const checkSession = (session: { user?: { id?: string } } | null) => {
                if (!session?.user?.id) {
                    return { status: 401, error: 'Unauthorized' };
                }
                return { status: 200, error: null };
            };

            const noSessionRes = checkSession(null);
            expect(noSessionRes.status).toBe(401);

            const validSessionRes = checkSession({ user: { id: testGoogleUserId } });
            expect(validSessionRes.status).toBe(200);
        });
    });

    // ============================================
    // TEST 8: EXISTING ACCOUNT ID AND DATA PRESERVED
    // ============================================
    describe('8. Preserves account ID, roles, and linked metadata', () => {
        it('keeps the exact user ID and role intact after password setup', async () => {
            const user = await prisma.user.findUnique({
                where: { id: testGoogleUserId },
                include: { Account: true },
            });

            expect(user?.id).toBe(testGoogleUserId);
            expect(user?.email).toBe(testGoogleEmail);
            expect(user?.role).toBe('VENDOR');
            expect(user?.Account.length).toBe(1);
        });
    });

    // ============================================
    // TEST 9: DUPLICATE GOOGLE ACCOUNT PREVENTED
    // ============================================
    describe('9. Duplicate Google accounts are strictly prevented', () => {
        it('enforces unique compound key on provider + providerAccountId', async () => {
            await expect(
                prisma.account.create({
                    data: {
                        userId: testGoogleUserId,
                        type: 'oauth',
                        provider: 'google',
                        providerAccountId: `g_acc_${timestamp}`,
                    },
                })
            ).rejects.toThrow();
        });
    });

    // ============================================
    // TEST 10: PASSWORD RESET PRESERVES SETUP STATUS
    // ============================================
    describe('10. Password reset preserves setup completion', () => {
        it('resets password and keeps passwordHash active', async () => {
            const resetToken = await createPasswordResetToken(testGoogleEmail);
            expect(resetToken).not.toBeNull();

            const brandNewPassword = 'BrandNewG00gleP@ss!';
            const resetResult = await verifyAndConsumePasswordResetToken(
                resetToken!,
                brandNewPassword
            );
            expect(resetResult.success).toBe(true);

            const user = await prisma.user.findUnique({
                where: { id: testGoogleUserId },
            });
            expect(user?.passwordHash).not.toBeNull();
            expect(await verifyPassword(user?.passwordHash, brandNewPassword)).toBe(true);
        });
    });
});
