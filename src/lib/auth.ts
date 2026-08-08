import { NextAuthOptions, getServerSession } from 'next-auth';
import GoogleProvider from 'next-auth/providers/google';
import { PrismaAdapter } from '@next-auth/prisma-adapter';
import { prisma } from '@/lib/prisma';
import { normalizeRole } from '@/lib/security/roles';
import { logger, redactEmail } from '@/lib/logger';

/**
 * NextAuth Configuration for Data Guardian (v4 Compatible)
 *
 * Session strategy is JWT so /api/auth/session does not hit Postgres on every
 * page navigation (database sessions were adding 2–4s latency via Neon).
 * User/Account records still live in Prisma via the adapter.
 */
const useSecureCookies = process.env.NEXTAUTH_URL?.startsWith('https://') ?? false;
const cookiePrefix = useSecureCookies ? '__Secure-' : '';

export const authOptions: NextAuthOptions = {
    adapter: PrismaAdapter(prisma),
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
            logger.info(`Sign-in: ${redactEmail(user.email)} via ${account?.provider}`);
            return true;
        },

        async redirect({ url, baseUrl }) {
            const canonicalBase = process.env.NEXTAUTH_URL || baseUrl;

            if (url.includes('/auth/role-select') || url.includes('/auth/signin')) {
                if (url.startsWith('/')) return `${canonicalBase}${url}`;
                return url;
            }

            return `${canonicalBase}/auth/role-select`;
        },

        async jwt({ token, user, trigger, session }) {
            // Initial sign-in: copy identity from adapter user
            if (user) {
                token.id = user.id;
                token.role = normalizeRole((user as { role?: string }).role);
                token.roleSelected = (user as { roleSelected?: boolean }).roleSelected ?? false;
            }

            // Client called update() after role selection — prefer payload, else DB
            if (trigger === 'update') {
                if (session?.role !== undefined) {
                    token.role = normalizeRole(session.role as string);
                    token.roleSelected = Boolean(session.roleSelected ?? true);
                } else if (token.id) {
                    const dbUser = await prisma.user.findUnique({
                        where: { id: token.id as string },
                        select: { role: true, roleSelected: true },
                    });
                    if (dbUser) {
                        token.role = normalizeRole(dbUser.role);
                        token.roleSelected = dbUser.roleSelected ?? false;
                    }
                }
            }

            return token;
        },

        async session({ session, token }) {
            if (session.user) {
                session.user.id = (token.id as string) ?? '';
                session.user.role = normalizeRole(token.role as string | undefined);
                session.user.roleSelected = Boolean(token.roleSelected);
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
            logger.info(`New user created: ${redactEmail(user.email)} (default: VENDOR)`);
        },
    },
};

/**
 * Get server session - use this in server components and server actions
 */
export async function auth() {
    return await getServerSession(authOptions);
}
