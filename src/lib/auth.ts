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
export const authOptions: NextAuthOptions = {
    adapter: PrismaAdapter(prisma),
    providers: [
        GoogleProvider({
            clientId: process.env.GOOGLE_CLIENT_ID!,
            clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
            // Force account selection every time for security
            authorization: {
                params: {
                    prompt: 'select_account',
                    access_type: 'offline',
                    response_type: 'code',
                },
            },
        }),
    ],
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
            // Don't redirect if already going to role-select
            if (url.includes('/auth/role-select')) {
                return url;
            }
            // For relative URLs or same-origin URLs, allow them
            if (url.startsWith('/')) {
                return `${baseUrl}${url}`;
            }
            if (url.startsWith(baseUrl)) {
                return url;
            }
            return baseUrl;
        },

        /**
         * Add custom fields to the session
         * CRITICAL: Role is fetched from DB, never from client
         */
        async session({ session, user }) {
            if (session.user) {
                session.user.id = user.id;
                // Fetch role from database (server-side truth)
                const dbUser = await prisma.user.findUnique({
                    where: { id: user.id },
                    select: { role: true, roleSelected: true },
                });
                (session.user as any).role = dbUser?.role || 'VENDOR';
                (session.user as any).roleSelected = dbUser?.roleSelected ?? false;
            }
            return session;
        },
    },
    pages: {
        signIn: '/auth/signin',
        error: '/auth/error',
    },
    // Enable debug mode to surface OAuth errors
    debug: true,
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
