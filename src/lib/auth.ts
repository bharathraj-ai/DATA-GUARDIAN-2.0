import { NextAuthOptions, getServerSession } from 'next-auth';
import GoogleProvider from 'next-auth/providers/google';
import { PrismaAdapter } from '@auth/prisma-adapter';
import { prisma } from '@/lib/prisma';
import type { Adapter } from 'next-auth/adapters';

/**
 * NextAuth Configuration for Data Guardian (v4 Compatible)
 * 
 * ZERO TRUST PRINCIPLES:
 * - Server-side identity verification via Google OAuth
 * - Roles assigned server-side, never trusted from client
 * - Session strategy: database (more secure than JWT for sensitive apps)
 */
export const authOptions: NextAuthOptions = {
    adapter: PrismaAdapter(prisma) as Adapter,
    providers: [
        GoogleProvider({
            clientId: process.env.GOOGLE_CLIENT_ID!,
            clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
            // Force account selection every time for security
            authorization: {
                params: {
                    prompt: 'select_account',
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
         * Add custom fields to the session
         * CRITICAL: Role is fetched from DB, never from client
         */
        async session({ session, user }) {
            if (session.user) {
                session.user.id = user.id;
                // Fetch role from database (server-side truth)
                const dbUser = await prisma.user.findUnique({
                    where: { id: user.id },
                    select: { role: true },
                });
                (session.user as any).role = dbUser?.role || 'VENDOR';
            }
            return session;
        },
    },
    pages: {
        signIn: '/auth/signin',
        error: '/auth/error',
    },
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
