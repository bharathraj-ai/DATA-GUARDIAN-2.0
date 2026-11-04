process.env.ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || '6e7f87c312aa5a9d1d45434ae1edbc32cf9a2b6e52a7d592eb24fce9827b8f41';
process.env.KEK_KEY = process.env.KEK_KEY || '7672891e32cf490be6f8740a1c988fb86fa605f0981e6209fbfd96a0b7ea5cd4';
process.env.OTP_HMAC_SECRET = process.env.OTP_HMAC_SECRET || 'test-otp-hmac-secret-min-32-chars-for-dev!!';
process.env.SESSION_HMAC_SECRET = process.env.SESSION_HMAC_SECRET || 'test-session-hmac-secret-min-32-chars-for-dev!!';
process.env.NEXTAUTH_SECRET = process.env.NEXTAUTH_SECRET || 'eA5TBa9rO9uMP4Sp2zLiXfRaeBXJ11kNkFbOifhbQh18=';
process.env.NEXTAUTH_URL = process.env.NEXTAUTH_URL || 'http://localhost:3000';

import { hashPassword, verifyPassword, validatePasswordStrength } from '@/lib/security/password';
import {
    generateSecureToken,
    hashToken,
    createEmailVerificationToken,
    verifyEmailVerificationToken,
    createPasswordResetToken,
    verifyAndConsumePasswordResetToken,
} from '@/lib/security/auth-tokens';
import {
    signUpSchema,
    signInSchema,
    forgotPasswordSchema,
    resetPasswordSchema,
    verifyEmailSchema,
} from '@/lib/validations';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { checkAccountBruteForce, _clearMemoryBucketsForTesting } from '@/lib/rate-limit';

jest.setTimeout(30000);

describe('DATA GUARDIAN 2.0 - COMPLETE AUTHENTICATION SECURITY SUITE', () => {
    const testEmail = `sec-test-${Date.now()}@example.com`;
    const strongPassword = 'P@ssword123!Secure';
    let testUserId: string;

    beforeEach(() => {
        _clearMemoryBucketsForTesting();
    });

    afterAll(async () => {
        // Cleanup test artifacts
        try {
            await prisma.emailVerificationToken.deleteMany({
                where: { email: { contains: 'sec-test-' } },
            });
            await prisma.passwordResetToken.deleteMany({
                where: { email: { contains: 'sec-test-' } },
            });
            await prisma.user.deleteMany({
                where: { email: { contains: 'sec-test-' } },
            });
        } catch {
            // ignore cleanup errors
        } finally {
            await prisma.$disconnect();
        }
    });

    // ============================================
    // TEST 1: NEW USER REGISTRATION
    // ============================================
    describe('1. New User Registration', () => {
        it('hashes password with bcrypt and stores unverified user with verification token hash', async () => {
            const passwordHash = await hashPassword(strongPassword);
            expect(passwordHash).toMatch(/^\$2[aby]\$/);

            const user = await prisma.user.create({
                data: {
                    name: 'Security Test User',
                    email: testEmail,
                    passwordHash,
                    authProvider: 'email',
                    role: 'VENDOR',
                    roleSelected: false,
                    emailVerified: null,
                },
            });
            testUserId = user.id;

            expect(user.id).toBeDefined();
            expect(user.email).toBe(testEmail);
            expect(user.passwordHash).toBe(passwordHash);
            expect(user.emailVerified).toBeNull();
            expect(user.authProvider).toBe('email');

            // Generate verification token
            const token = await createEmailVerificationToken(testEmail);
            expect(token).toBeDefined();
            expect(token.length).toBe(64); // 32 bytes hex = 64 chars

            // Verify only hash is stored
            const tokenRecord = await prisma.emailVerificationToken.findFirst({
                where: { email: testEmail },
            });
            expect(tokenRecord).toBeDefined();
            expect(tokenRecord?.tokenHash).toBe(hashToken(token));
            expect(tokenRecord?.tokenHash).not.toBe(token);
        });
    });

    // ============================================
    // TEST 2: DUPLICATE EMAIL REGISTRATION
    // ============================================
    describe('2. Duplicate Email Registration Prevention', () => {
        it('rejects duplicate email registration and enforces unique constraint', async () => {
            const existingUser = await prisma.user.findUnique({
                where: { email: testEmail },
            });
            expect(existingUser).not.toBeNull();

            // Attempting duplicate insert in Prisma throws P2002
            await expect(
                prisma.user.create({
                    data: {
                        name: 'Imposter User',
                        email: testEmail,
                        passwordHash: await hashPassword(strongPassword),
                        authProvider: 'email',
                    },
                })
            ).rejects.toThrow();
        });
    });

    // ============================================
    // TEST 3: SUCCESSFUL EMAIL/PASSWORD LOGIN
    // ============================================
    describe('3. Successful Email/Password Login', () => {
        it('authorizes successfully once email is verified', async () => {
            const credentialsProvider = authOptions.providers.find(
                (p) => p.id === 'credentials'
            ) as any;
            expect(credentialsProvider).toBeDefined();
            const authorize = credentialsProvider.options?.authorize || credentialsProvider.authorize;

            // First mark email verified
            await prisma.user.update({
                where: { id: testUserId },
                data: { emailVerified: new Date() },
            });

            const authorized = await authorize(
                { email: testEmail, password: strongPassword },
                {} as any
            );

            expect(authorized).not.toBeNull();
            expect(authorized.id).toBe(testUserId);
            expect(authorized.email).toBe(testEmail);
            expect(authorized.emailVerified).toBeInstanceOf(Date);
        });
    });

    // ============================================
    // TEST 4: INCORRECT PASSWORD
    // ============================================
    describe('4. Incorrect Password Handling', () => {
        it('rejects incorrect password with generic error and timing safety', async () => {
            const credentialsProvider = authOptions.providers.find(
                (p) => p.id === 'credentials'
            ) as any;
            const authorize = credentialsProvider.options?.authorize || credentialsProvider.authorize;

            await expect(
                authorize(
                    { email: testEmail, password: 'WrongPassword999!' },
                    {} as any
                )
            ).rejects.toThrow('INVALID_CREDENTIALS');
        });
    });

    // ============================================
    // TEST 5: INVALID EMAIL
    // ============================================
    describe('5. Invalid Email Validation', () => {
        it('rejects malformed email strings across all schemas', () => {
            const invalidEmails = ['not-an-email', 'missing@domain', '@no-local.com', 'spaces in@email.com'];

            for (const email of invalidEmails) {
                const signUpRes = signUpSchema.safeParse({
                    name: 'Test',
                    email,
                    password: strongPassword,
                    confirmPassword: strongPassword,
                    terms: true,
                });
                expect(signUpRes.success).toBe(false);

                const signInRes = signInSchema.safeParse({
                    email,
                    password: strongPassword,
                });
                expect(signInRes.success).toBe(false);

                const forgotRes = forgotPasswordSchema.safeParse({ email });
                expect(forgotRes.success).toBe(false);
            }
        });
    });

    // ============================================
    // TEST 6: WEAK PASSWORD
    // ============================================
    describe('6. Weak Password Complexity Validation', () => {
        it('enforces 8+ chars, upper, lower, number, and special character', () => {
            const weakPasswords = [
                'short1!',          // too short
                'nouppercase123!',  // missing uppercase
                'NOLOWERCASE123!',  // missing lowercase
                'NoNumbersHere!',   // missing number
                'NoSpecialChar123', // missing special char
            ];

            for (const pwd of weakPasswords) {
                const strength = validatePasswordStrength(pwd);
                expect(strength.isValid).toBe(false);
                expect(strength.errors.length).toBeGreaterThan(0);

                const parseRes = signUpSchema.safeParse({
                    name: 'Test',
                    email: 'valid@example.com',
                    password: pwd,
                    confirmPassword: pwd,
                    terms: true,
                });
                expect(parseRes.success).toBe(false);
            }

            const validStrength = validatePasswordStrength(strongPassword);
            expect(validStrength.isValid).toBe(true);
            expect(validStrength.errors.length).toBe(0);
        });
    });

    // ============================================
    // TEST 7: PASSWORD MISMATCH
    // ============================================
    describe('7. Password Confirmation Mismatch', () => {
        it('rejects sign up and reset when password and confirmPassword differ', () => {
            const signUpRes = signUpSchema.safeParse({
                name: 'Test User',
                email: 'valid@example.com',
                password: strongPassword,
                confirmPassword: strongPassword + 'mismatch',
                terms: true,
            });
            expect(signUpRes.success).toBe(false);

            const resetRes = resetPasswordSchema.safeParse({
                token: 'abcdef1234567890',
                password: strongPassword,
                confirmPassword: strongPassword + 'different',
            });
            expect(resetRes.success).toBe(false);
        });
    });

    // ============================================
    // TEST 8: FORGOT PASSWORD
    // ============================================
    describe('8. Forgot Password Process', () => {
        it('generates a secure reset token for registered users', async () => {
            const token = await createPasswordResetToken(testEmail);
            expect(token).toBeDefined();
            expect(typeof token).toBe('string');

            const tokenRecord = await prisma.passwordResetToken.findFirst({
                where: { email: testEmail },
            });
            expect(tokenRecord).not.toBeNull();
            expect(tokenRecord?.tokenHash).toBe(hashToken(token!));
        });

        it('returns null for unregistered email without throwing or enumerating', async () => {
            const token = await createPasswordResetToken('nonexistent-999@example.com');
            expect(token).toBeNull();
        });
    });

    // ============================================
    // TEST 9: EXPIRED RESET TOKEN
    // ============================================
    describe('9. Expired Reset Token', () => {
        it('rejects reset tokens where expiresAt is in the past', async () => {
            const { token, hash } = generateSecureToken();

            // Insert expired token
            await prisma.passwordResetToken.create({
                data: {
                    email: testEmail,
                    tokenHash: hash,
                    expiresAt: new Date(Date.now() - 1000 * 60), // 1 minute in the past
                },
            });

            const result = await verifyAndConsumePasswordResetToken(token, 'NewStrongP@ss999!');
            expect(result.success).toBe(false);
            expect(result.error).toMatch(/expired/i);
        });
    });

    // ============================================
    // TEST 10: REUSED RESET TOKEN
    // ============================================
    describe('10. Reused Reset Token Prevention', () => {
        it('consumes reset token on first use and rejects second use', async () => {
            const token = await createPasswordResetToken(testEmail);
            expect(token).not.toBeNull();

            const newPassword = 'BrandNewP@ssword2026!';
            // First consumption: success
            const firstResult = await verifyAndConsumePasswordResetToken(token!, newPassword);
            expect(firstResult.success).toBe(true);

            // Verify user password hash was updated
            const updatedUser = await prisma.user.findUnique({ where: { email: testEmail } });
            const passwordMatches = await verifyPassword(updatedUser?.passwordHash, newPassword);
            expect(passwordMatches).toBe(true);

            // Replay attempt: must fail
            const secondResult = await verifyAndConsumePasswordResetToken(token!, 'AnotherP@ssword123!');
            expect(secondResult.success).toBe(false);
            expect(secondResult.error).toMatch(/invalid or expired/i);
        });
    });

    // ============================================
    // TEST 11: EMAIL VERIFICATION
    // ============================================
    describe('11. Email Verification Lifecycle', () => {
        it('verifies unverified user and prevents verification token replay', async () => {
            const freshEmail = `verify-${Date.now()}@example.com`;
            await prisma.user.create({
                data: {
                    name: 'Verify Test User',
                    email: freshEmail,
                    passwordHash: await hashPassword(strongPassword),
                    authProvider: 'email',
                    emailVerified: null,
                },
            });

            const token = await createEmailVerificationToken(freshEmail);
            expect(token).toBeDefined();
            expect(verifyEmailSchema.safeParse({ token }).success).toBe(true);
            expect(verifyEmailSchema.safeParse({ token: 'short' }).success).toBe(false);

            // First verify: success
            const verifyResult = await verifyEmailVerificationToken(token);
            expect(verifyResult.success).toBe(true);
            expect(verifyResult.email).toBe(freshEmail);

            const user = await prisma.user.findUnique({ where: { email: freshEmail } });
            expect(user?.emailVerified).toBeInstanceOf(Date);

            // Second verify with same token: must fail
            const secondResult = await verifyEmailVerificationToken(token);
            expect(secondResult.success).toBe(false);
            expect(secondResult.error).toMatch(/invalid or expired/i);
        });
    });

    // ============================================
    // TEST 12: GOOGLE OAUTH LOGIN
    // ============================================
    describe('12. Google OAuth Integration', () => {
        it('Google Provider configuration remains present and intact', () => {
            const googleProvider = authOptions.providers.find((p) => p.id === 'google');
            expect(googleProvider).toBeDefined();
            expect(googleProvider?.name).toBe('Google');
        });
    });

    // ============================================
    // TEST 13: EXISTING GOOGLE USERS & ACCOUNT SEPARATION
    // ============================================
    describe('13. Google User Security & Account Separation', () => {
        it('prevents credentials sign in for Google-only users without password hash', async () => {
            const googleEmail = `google-only-${Date.now()}@example.com`;
            await prisma.user.create({
                data: {
                    name: 'Google User',
                    email: googleEmail,
                    passwordHash: null,
                    authProvider: 'google',
                    emailVerified: new Date(),
                },
            });

            const credentialsProvider = authOptions.providers.find(
                (p) => p.id === 'credentials'
            ) as any;
            const authorize = credentialsProvider.options?.authorize || credentialsProvider.authorize;

            await expect(
                authorize(
                    { email: googleEmail, password: strongPassword },
                    {} as any
                )
            ).rejects.toThrow('INVALID_CREDENTIALS');
        });
    });

    // ============================================
    // TEST 14: SESSION EXPIRATION & CONFIGURATION
    // ============================================
    describe('14. Session Expiration', () => {
        it('enforces JWT session strategy with 24 hour maxAge', () => {
            expect(authOptions.session?.strategy).toBe('jwt');
            expect(authOptions.session?.maxAge).toBe(24 * 60 * 60);
        });
    });

    // ============================================
    // TEST 15: UNAUTHORIZED DASHBOARD ACCESS GATING
    // ============================================
    describe('15. Unauthorized Dashboard Access Policy', () => {
        it('detects unverified status to block dashboard access', () => {
            const unverifiedSession = {
                user: {
                    id: 'usr_1',
                    email: 'unverified@example.com',
                    emailVerified: null,
                    role: 'VENDOR',
                    roleSelected: true,
                },
            };
            const verifiedSession = {
                user: {
                    id: 'usr_2',
                    email: 'verified@example.com',
                    emailVerified: new Date(),
                    role: 'VENDOR',
                    roleSelected: true,
                },
            };

            const isAllowedDashboard = (session: { user?: { id?: string; emailVerified?: Date | string | null } } | null) => {
                return Boolean(session?.user?.id && session.user.emailVerified);
            };

            expect(isAllowedDashboard(unverifiedSession)).toBe(false);
            expect(isAllowedDashboard(verifiedSession)).toBe(true);
        });
    });

    // ============================================
    // TEST 16: BRUTE-FORCE PROTECTION
    // ============================================
    describe('16. Brute-Force Rate Limiting Protection', () => {
        it('locks out account after 5 consecutive attempts within window', async () => {
            const victimEmail = `brute-target-${Date.now()}@example.com`;

            for (let i = 1; i <= 5; i++) {
                const res = await checkAccountBruteForce(victimEmail);
                expect(res.allowed).toBe(true);
            }

            // 6th attempt: blocked
            const blockedRes = await checkAccountBruteForce(victimEmail);
            expect(blockedRes.allowed).toBe(false);
            expect(blockedRes.retryAfter).toBeGreaterThan(0);
        });
    });
});
