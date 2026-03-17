import { NextAuthOptions, getServerSession } from 'next-auth';
import GoogleProvider from 'next-auth/providers/google';
import { PrismaAdapter } from '@next-auth/prisma-adapter';
import { prisma } from '@/lib/prisma';

/**
 * NextAuth Configuration for Data Guardian (v4 Compatible)
 * 
 * ZERO TRUST PRINCIPLES:
 * - Server-side identity verification via Google OAuth
 * - Roles assigned server-side, never trusted from client
 * - Session strategy: database (more secure than JWT for sensitive apps)
 */
// Determine if running on localhost (non-HTTPS)
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
            // Force account selection every time for security
            authorization: {
                params: {
                    prompt: 'select_account',
                },
            },
        }),
    ],
    // Explicit cookie config to prevent "State cookie was missing" error
    // This ensures cookies are properly set/read during OAuth redirects on localhost
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
                maxAge: 60 * 15, // 15 minutes
            },
        },
        state: {
            name: `${cookiePrefix}next-auth.state`,
            options: {
                httpOnly: true,
                sameSite: 'lax',
                path: '/',
                secure: useSecureCookies,
                maxAge: 60 * 15, // 15 minutes
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
        // Use database sessions for better security (revocable)
        strategy: 'database',
        maxAge: 24 * 60 * 60, // 24 hours
    },
    callbacks: {
        /**
         * Control access based on authentication status
         * Vendor routes require authentication
         */
        async signIn({ user, account }) {
            // Log sign-in for audit trail (non-blocking)
            console.log(`[AUTH] Sign-in: ${user.email} via ${account?.provider}`);
            return true;
        },

        /**
         * Redirect new users to role selection page after sign-in
         */
        async redirect({ url, baseUrl }) {
            // Always use NEXTAUTH_URL as the baseUrl to prevent port mismatches
            const canonicalBase = process.env.NEXTAUTH_URL || baseUrl;

            // Don't redirect if already going to role-select
            if (url.includes('/auth/role-select')) {
                return url;
            }
            // For relative URLs or same-origin URLs, allow them
            if (url.startsWith('/')) {
                return `${canonicalBase}${url}`;
            }
            if (url.startsWith(canonicalBase)) {
                return url;
            }
            return canonicalBase;
        },

        /**
         * Add custom fields to the session
         * CRITICAL: Role is fetched from DB, never from client
         */
        async session({ session, user }) {
            if (session.user) {
                session.user.id = user.id;
                // NextAuth PrismaAdapter already fetches the full user object from the database.
                // We can access custom fields directly without an extra database query.
                session.user.role = ((user as any).role as 'OWNER' | 'VENDOR') || 'VENDOR';
                session.user.roleSelected = (user as any).roleSelected ?? false;
            }
            return session;
        },
    },
    pages: {
        signIn: '/auth/signin',
        error: '/auth/error',
    },
    // Disable debug mode in production to avoid leaking secrets
    debug: process.env.NODE_ENV === 'development',
    events: {
        /**
         * Auto-create new users as VENDOR role by default
         * OWNER role must be explicitly assigned (e.g., first user or admin)
         */
        async createUser({ user }) {
            console.log(`[AUTH] New user created: ${user.email} (default: VENDOR)`);
        },
    },
};

/**
 * Get server session - use this in server components and server actions
 */
export async function auth() {
    return await getServerSession(authOptions);
}
