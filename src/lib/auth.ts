import { cache } from 'react';
import { NextAuthOptions, getServerSession } from 'next-auth';
import GoogleProvider from 'next-auth/providers/google';
import type { OAuthConfig } from 'next-auth/providers/oauth';
import { prisma } from '@/lib/prisma';
import { createRaceSafePrismaAdapter } from '@/lib/auth-adapter';
import { normalizeRole } from '@/lib/security/roles';
import { getOnboardingStep } from '@/lib/onboarding';
import { logger, redactEmail } from '@/lib/logger';
import { assertEmailAllowedForHostedDomain, attachUserToMatchingOrg } from '@/lib/tenant';
import { acceptPendingOrgInvites } from '@/lib/org-invites';

/**
 * NextAuth Configuration for Secure Protocol (v4 Compatible)
 *
 * Session strategy is JWT so /api/auth/session does not hit Postgres on every
 * page navigation (database sessions were adding 2–4s latency via Neon).
 * User/Account records still live in Prisma via the adapter.
 *
 * Post-login routing: OAuth always lands on /auth/continue, which reads DB
 * onboarding state and redirects by role hierarchy (COMPLETE) or
 * /auth/role-select (ROLE_SELECTION).
 */
const useSecureCookies = process.env.NEXTAUTH_URL?.startsWith('https://') ?? false;
const cookiePrefix = useSecureCookies ? '__Secure-' : '';

function postLoginContinueUrl(canonicalBase: string, callbackPath?: string | null): string {
    if (callbackPath && callbackPath.startsWith('/') && !callbackPath.startsWith('//')) {
        return `${canonicalBase}/auth/continue?callbackUrl=${encodeURIComponent(callbackPath)}`;
    }
    return `${canonicalBase}/auth/continue`;
}

function oidcProvider(): OAuthConfig<Record<string, string>> | null {
    const issuer = process.env.OIDC_ISSUER?.trim().replace(/\/$/, '');
    const clientId = process.env.OIDC_CLIENT_ID?.trim();
    const clientSecret = process.env.OIDC_CLIENT_SECRET?.trim();
    if (!issuer || !clientId || !clientSecret) return null;
    return {
        id: 'oidc',
        name: process.env.OIDC_NAME?.trim() || 'SSO',
        type: 'oauth',
        wellKnown: `${issuer}/.well-known/openid-configuration`,
        clientId,
        clientSecret,
        authorization: { params: { scope: 'openid email profile' } },
        idToken: true,
        checks: ['pkce', 'state'],
        profile(profile) {
            return {
                id: profile.sub,
                name: profile.name ?? profile.preferred_username ?? profile.email,
                email: profile.email,
                image: profile.picture,
            };
        },
    };
}

const oidc = oidcProvider();
const hostedDomain = process.env.GOOGLE_HOSTED_DOMAIN?.trim();

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
                    ...(hostedDomain ? { hd: hostedDomain } : {}),
                },
            },
        }),
        ...(oidc ? [oidc] : []),
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
            if (!assertEmailAllowedForHostedDomain(user.email)) {
                logger.warn(
                    `[SSO] Rejected email domain email=${redactEmail(user.email)} provider=${account?.provider}`,
                );
                return false;
            }
            if (user.id) {
                await attachUserToMatchingOrg(user.id, user.email).catch(() => undefined);
                await acceptPendingOrgInvites(user.id, user.email).catch(() => undefined);

            }
            const roleSelected = Boolean(
                (user as { roleSelected?: boolean }).roleSelected
            );
            const onboardingStep = getOnboardingStep(roleSelected);
            logger.info(
                `[Google OAuth] Sign-in email=${redactEmail(user.email)} provider=${account?.provider} onboardingStep=${onboardingStep}`
            );
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
                token.onboardingStep = getOnboardingStep(roleSelected);
                const orgRow = await prisma.user.findUnique({
                    where: { id: user.id },
                    select: { organizationId: true },
                });
                token.organizationId = orgRow?.organizationId ?? null;
                logger.info(
                    `[OAuth] JWT issued userId=${user.id} onboardingStep=${token.onboardingStep}`
                );
            }

            // Client called update() after role selection — ALWAYS refresh from DB.
            // Never trust client-supplied role / roleSelected (privilege-escalation vector).
            if (trigger === 'update' && token.id) {
                const dbUser = await prisma.user.findUnique({
                    where: { id: token.id as string },
                    select: { role: true, roleSelected: true, organizationId: true },
                });
                if (dbUser) {
                    token.role = normalizeRole(dbUser.role);
                    token.roleSelected = dbUser.roleSelected ?? false;
                    token.onboardingStep = getOnboardingStep(dbUser.roleSelected);
                    token.organizationId = dbUser.organizationId ?? null;
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
                session.user.onboardingStep = getOnboardingStep(
                    Boolean(token.roleSelected)
                );
                session.user.organizationId = (token.organizationId as string | null) ?? null;
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
                `[OAuth] New user created email=${redactEmail(user.email)} Existing user: false onboardingStep=ROLE_SELECTION`
            );
            if (user.id) {
                await attachUserToMatchingOrg(user.id, user.email).catch(() => undefined);
                await acceptPendingOrgInvites(user.id, user.email).catch(() => undefined);

            }
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
