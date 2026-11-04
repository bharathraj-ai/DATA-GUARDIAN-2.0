import { cache } from 'react';
import { NextAuthOptions, getServerSession } from 'next-auth';
import GoogleProvider from 'next-auth/providers/google';
import CredentialsProvider from 'next-auth/providers/credentials';
import { prisma } from '@/lib/prisma';
import { createRaceSafePrismaAdapter } from '@/lib/auth-adapter';
import { normalizeRole } from '@/lib/security/roles';
import { getOnboardingStep } from '@/lib/onboarding';
import { logger, redactEmail } from '@/lib/logger';
import { verifyPassword } from '@/lib/security/password';
import { signInSchema } from '@/lib/validations';
import { checkAccountBruteForce, resetAccountBruteForce } from '@/lib/rate-limit';

/**
 * NextAuth Configuration for Data Guardian (v4 Compatible)
 *
 * Session strategy is JWT so /api/auth/session does not hit Postgres on every
 * page navigation (database sessions were adding 2–4s latency via Neon).
 * User/Account records still live in Prisma via the adapter.
 *
 * Post-login routing: OAuth always lands on /auth/continue, which reads DB
 * onboarding state and redirects to /dashboard/owner or /dashboard/vendor
 * (COMPLETE) or /auth/role-select (ROLE_SELECTION). Completed users never
 * visit role-select.
 */
const useSecureCookies = process.env.NEXTAUTH_URL?.startsWith('https://') ?? false;
const cookiePrefix = useSecureCookies ? '__Secure-' : '';

function postLoginContinueUrl(canonicalBase: string, callbackPath?: string | null): string {
    if (callbackPath && callbackPath.startsWith('/') && !callbackPath.startsWith('//')) {
        return `${canonicalBase}/auth/continue?callbackUrl=${encodeURIComponent(callbackPath)}`;
    }
    return `${canonicalBase}/auth/continue`;
}

export const authOptions: NextAuthOptions = {
    adapter: createRaceSafePrismaAdapter(prisma),
    providers: [
        GoogleProvider({
            clientId: process.env.GOOGLE_CLIENT_ID!,
            clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
            httpOptions: {
                timeout: 10000,
            },
            authorization: {
                params: {
                    prompt: 'select_account',
                },
            },
        }),
        CredentialsProvider({
            id: 'credentials',
            name: 'Email and Password',
            credentials: {
                email: { label: 'Email', type: 'email' },
                password: { label: 'Password', type: 'password' },
            },
            async authorize(credentials) {
                const parsed = signInSchema.safeParse(credentials);
                if (!parsed.success) {
                    logger.warn(`[Auth] Credentials rejected: invalid schema validation: ${parsed.error.message}`);
                    throw new Error('INVALID_CREDENTIALS');
                }

                const { email, password } = parsed.data;
                const normalizedEmail = email.trim().toLowerCase();

                // Prevent brute-force password guessing against targeted accounts
                const accountRateCheck = await checkAccountBruteForce(normalizedEmail);
                if (!accountRateCheck.allowed) {
                    logger.warn(`[Auth] Brute-force protection: account locked out email=${redactEmail(normalizedEmail)}`);
                    throw new Error('ACCOUNT_LOCKED');
                }

                const user = await prisma.user.findUnique({
                    where: { email: normalizedEmail },
                });

                if (!user || !user.passwordHash) {
                    logger.warn(`[Auth] Credentials rejected: no user or password hash email=${redactEmail(normalizedEmail)}`);
                    throw new Error('INVALID_CREDENTIALS');
                }

                const isValidPassword = await verifyPassword(user.passwordHash, password);
                if (!isValidPassword) {
                    logger.warn(`[Auth] Credentials rejected: incorrect password email=${redactEmail(normalizedEmail)}`);
                    throw new Error('INVALID_CREDENTIALS');
                }

                if (!user.emailVerified) {
                    logger.warn(`[Auth] Credentials rejected: email not verified email=${redactEmail(normalizedEmail)}`);
                    throw new Error('EMAIL_NOT_VERIFIED');
                }

                // Reset brute-force lockout counter on successful authentication
                await resetAccountBruteForce(normalizedEmail);

                logger.info(`[Auth] Credentials login successful email=${redactEmail(normalizedEmail)}`);
                return {
                    id: user.id,
                    email: user.email,
                    name: user.name,
                    role: user.role,
                    roleSelected: user.roleSelected,
                    emailVerified: user.emailVerified,
                    passwordHash: user.passwordHash,
                    hasPassword: true,
                    passwordSet: true,
                };
            },
        }),
    ],
    useSecureCookies,
    cookies: {
        sessionToken: {
            name: `${cookiePrefix}next-auth.session-token`,
            options: {
                httpOnly: true,
                sameSite: 'lax',
                path: '/',
                secure: useSecureCookies,
            },
        },
        callbackUrl: {
            name: `${cookiePrefix}next-auth.callback-url`,
            options: {
                sameSite: 'lax',
                path: '/',
                secure: useSecureCookies,
            },
        },
        csrfToken: {
            name: `${cookiePrefix}next-auth.csrf-token`,
            options: {
                httpOnly: true,
                sameSite: 'lax',
                path: '/',
                secure: useSecureCookies,
            },
        },
        pkceCodeVerifier: {
            name: `${cookiePrefix}next-auth.pkce.code_verifier`,
            options: {
                httpOnly: true,
                sameSite: 'lax',
                path: '/',
                secure: useSecureCookies,
                maxAge: 60 * 15,
            },
        },
        state: {
            name: `${cookiePrefix}next-auth.state`,
            options: {
                httpOnly: true,
                sameSite: 'lax',
                path: '/',
                secure: useSecureCookies,
                maxAge: 60 * 15,
            },
        },
        nonce: {
            name: `${cookiePrefix}next-auth.nonce`,
            options: {
                httpOnly: true,
                sameSite: 'lax',
                path: '/',
                secure: useSecureCookies,
            },
        },
    },
    session: {
        strategy: 'jwt',
        maxAge: 24 * 60 * 60, // 24 hours
    },
    callbacks: {
        async signIn({ user, account }) {
            const roleSelected = Boolean(
                (user as { roleSelected?: boolean }).roleSelected
            );
            const onboardingStep = getOnboardingStep(roleSelected);
            logger.info(
                `[Google OAuth] Sign-in email=${redactEmail(user.email)} provider=${account?.provider} onboardingStep=${onboardingStep}`
            );

            if (account?.provider === 'google' && user.id) {
                // Google accounts are verified by Google. Ensure existing users without an emailVerified timestamp are marked verified.
                await prisma.user.update({
                    where: { id: user.id },
                    data: { emailVerified: new Date() },
                }).catch(() => {});
            }

            return true;
        },

        async redirect({ url, baseUrl }) {
            const canonicalBase = process.env.NEXTAUTH_URL || baseUrl;

            let absolute = url;
            if (url.startsWith('/')) {
                absolute = `${canonicalBase}${url}`;
            }

            try {
                const target = new URL(absolute, canonicalBase);
                const base = new URL(canonicalBase);

                // Reject cross-origin redirects (open-redirect protection)
                if (target.origin !== base.origin) {
                    return postLoginContinueUrl(canonicalBase);
                }

                const path = `${target.pathname}${target.search}` || '/';

                // Already on the post-login router or explicit auth pages — keep
                if (
                    target.pathname === '/auth/continue' ||
                    target.pathname === '/auth/signin' ||
                    target.pathname === '/auth/set-password' ||
                    target.pathname === '/auth/error'
                ) {
                    return `${canonicalBase}${path}`;
                }

                // Never send OAuth straight to role-select; continue decides
                if (target.pathname === '/auth/role-select') {
                    const nested = target.searchParams.get('callbackUrl');
                    return postLoginContinueUrl(canonicalBase, nested);
                }

                // Same-origin app destinations → continue (then dashboard or role-select)
                if (path !== '/' && !path.startsWith('/auth/')) {
                    return postLoginContinueUrl(canonicalBase, path);
                }

                if (path.startsWith('/auth/')) {
                    return `${canonicalBase}${path}`;
                }
            } catch {
                // fall through
            }

            return postLoginContinueUrl(canonicalBase);
        },

        async jwt({ token, user, trigger }) {
            // Initial sign-in: copy identity from adapter user (DB defaults included)
            if (user) {
                const roleSelected =
                    (user as { roleSelected?: boolean }).roleSelected ?? false;
                token.id = user.id;
                token.role = normalizeRole((user as { role?: string }).role);
                token.roleSelected = roleSelected;
                let emailVerified = (user as { emailVerified?: Date | string | null }).emailVerified ?? null;
                // If user has a linked Google account or is logging in via Google, email is verified
                if (!emailVerified && user.id) {
                    const hasGoogle = await prisma.account.findFirst({
                        where: { userId: user.id, provider: 'google' },
                        select: { id: true },
                    });
                    if (hasGoogle) {
                        emailVerified = new Date();
                        await prisma.user.update({
                            where: { id: user.id },
                            data: { emailVerified },
                        }).catch(() => {});
                    }
                }
                token.emailVerified = emailVerified;
                token.onboardingStep = getOnboardingStep(roleSelected);

                let hasPassword = Boolean((user as { passwordHash?: string | null }).passwordHash ?? (user as { hasPassword?: boolean }).hasPassword);
                if (!hasPassword && user.id) {
                    const dbUser = await prisma.user.findUnique({
                        where: { id: user.id },
                        select: { passwordHash: true },
                    });
                    hasPassword = Boolean(dbUser?.passwordHash);
                }
                token.hasPassword = hasPassword;
                token.passwordSet = hasPassword;

                logger.info(
                    `[Auth] JWT issued userId=${user.id} hasPassword=${hasPassword} onboardingStep=${token.onboardingStep}`
                );
            }

            // Client called update() after role selection or password setup — ALWAYS refresh from DB.
            // Never trust client-supplied values (privilege-escalation vector).
            if (trigger === 'update' && token.id) {
                const dbUser = await prisma.user.findUnique({
                    where: { id: token.id as string },
                    select: { role: true, roleSelected: true, emailVerified: true, passwordHash: true },
                });
                if (dbUser) {
                    token.role = normalizeRole(dbUser.role);
                    token.roleSelected = dbUser.roleSelected ?? false;
                    token.emailVerified = dbUser.emailVerified ?? null;
                    token.hasPassword = Boolean(dbUser.passwordHash);
                    token.passwordSet = token.hasPassword;
                    token.onboardingStep = getOnboardingStep(dbUser.roleSelected);
                }
            }

            if (!token.onboardingStep) {
                token.onboardingStep = getOnboardingStep(Boolean(token.roleSelected));
            }

            return token;
        },

        async session({ session, token }) {
            if (session.user) {
                session.user.id = (token.id as string) ?? '';
                session.user.role = normalizeRole(token.role as string | undefined);
                session.user.roleSelected = Boolean(token.roleSelected);
                session.user.emailVerified = (token.emailVerified as Date | string | null) ?? null;
                session.user.hasPassword = Boolean(token.hasPassword);
                session.user.passwordSet = Boolean(token.passwordSet);
                session.user.onboardingStep = getOnboardingStep(
                    Boolean(token.roleSelected)
                );
            }
            return session;
        },
    },
    pages: {
        signIn: '/auth/signin',
        error: '/auth/error',
    },
    // Keep quiet in terminal — debug dumps encrypted session blobs
    debug: false,
    logger: {
        error(code, metadata) {
            logger.error(`[NEXTAUTH ERROR] ${code}`, metadata);
        },
        warn(code) {
            logger.warn(`[NEXTAUTH WARN] ${code}`);
        },
        debug() {
            // no-op: avoid logging session tokens
        },
    },
    events: {
        async createUser({ user }) {
            logger.info(
                `[Google OAuth] New user created email=${redactEmail(user.email)} Existing user: false onboardingStep=ROLE_SELECTION`
            );
        },
    },
};

/**
 * Get server session - use this in server components and server actions.
 * React cache() dedupes within a single request (layout + page + actions).
 */
export const auth = cache(async () => {
    return await getServerSession(authOptions);
});
