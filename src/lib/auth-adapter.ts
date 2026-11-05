import { Prisma, type PrismaClient } from '@prisma/client';
import { PrismaAdapter } from '@next-auth/prisma-adapter';
import type { Adapter, AdapterAccount, AdapterUser } from 'next-auth/adapters';
import { logger, redactEmail } from '@/lib/logger';

function isUniqueViolation(error: unknown): boolean {
    return (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
    );
}

type AdapterUserCreate = Omit<AdapterUser, 'id'>;

/**
 * PrismaAdapter wrapper that makes Google user create + account link idempotent
 * under concurrent OAuth callbacks for the same Google account / email.
 */
export function createRaceSafePrismaAdapter(prisma: PrismaClient): Adapter {
    const base = PrismaAdapter(prisma);

    return {
        ...base,

        async getUserByEmail(email: string) {
            const user = await base.getUserByEmail!(email);
            if (!user) return null;

            // If an unverified manual account exists with no linked OAuth accounts,
            // the registrant has not proven ownership of this email address.
            // Returning null allows verified Google OAuth to claim and sanitize the account in createUser
            // without being blocked by OAuthAccountNotLinked or exposing pre-hijacked passwords.
            if (!user.emailVerified) {
                const hasLinkedAccounts = await prisma.account.findFirst({
                    where: { userId: user.id },
                    select: { id: true },
                });
                if (!hasLinkedAccounts) {
                    logger.info(
                        `[Google OAuth] Found unverified manual account without linked OAuth for email=${redactEmail(email)}. Yielding to verified OAuth claim.`
                    );
                    return null;
                }
            }

            return user;
        },

        async createUser(data: AdapterUserCreate) {
            try {
                const user = await base.createUser!(data);
                logger.info(
                    `[Google OAuth] Creating new user email=${redactEmail(user.email)} onboardingStep=ROLE_SELECTION`
                );
                return user;
            } catch (error) {
                if (isUniqueViolation(error) && data.email) {
                    const existing = await prisma.user.findUnique({
                        where: { email: data.email },
                    });
                    if (existing) {
                        // If existing user is unverified and has a passwordHash, wipe the unverified password
                        // to prevent pre-hijacking attacks where an attacker pre-registered the victim's email.
                        if (!existing.emailVerified && existing.passwordHash) {
                            logger.warn(
                                `[Google OAuth] Wiping unverified password for email=${redactEmail(existing.email)} upon verified Google sign-in`
                            );
                            const sanitized = await prisma.user.update({
                                where: { id: existing.id },
                                data: {
                                    passwordHash: null,
                                    emailVerified: new Date(),
                                },
                            });
                            return sanitized as AdapterUser;
                        }

                        // If user is already verified with a password and has no Google account,
                        // block automatic linking to prevent unsafe account takeover.
                        if (existing.emailVerified && existing.passwordHash) {
                            const hasGoogle = await prisma.account.findFirst({
                                where: { userId: existing.id, provider: 'google' },
                                select: { id: true },
                            });
                            if (!hasGoogle) {
                                logger.warn(
                                    `[Google OAuth] Blocked automatic linking to verified password account email=${redactEmail(existing.email)}`
                                );
                                throw new Error('OAuthAccountNotLinked');
                            }
                        }

                        logger.info(
                            `[Google OAuth] createUser race: reused existing user email=${redactEmail(existing.email)} roleSelected=${existing.roleSelected}`
                        );
                        return existing as AdapterUser;
                    }
                }
                throw error;
            }
        },

        async linkAccount(account: AdapterAccount) {
            try {
                return await base.linkAccount!(account);
            } catch (error) {
                if (isUniqueViolation(error)) {
                    const existing = await prisma.account.findUnique({
                        where: {
                            provider_providerAccountId: {
                                provider: account.provider,
                                providerAccountId: account.providerAccountId,
                            },
                        },
                    });
                    if (existing) {
                        logger.info(
                            `[Google OAuth] linkAccount race: account already linked provider=${account.provider}`
                        );
                        // NextAuth ignores the return value of linkAccount in practice;
                        // returning the input keeps the adapter contract satisfied.
                        return account;
                    }
                }
                throw error;
            }
        },

        async getUserByAccount(providerAccountId: {
            provider: string;
            providerAccountId: string;
        }) {
            const user = await base.getUserByAccount!(providerAccountId);
            if (user) {
                logger.info(
                    `[Google OAuth] Google account found email=${redactEmail(user.email)} existingUser=true roleSelected=${Boolean((user as AdapterUser & { roleSelected?: boolean }).roleSelected)}`
                );
            } else {
                logger.info(
                    `[Google OAuth] Google account not found provider=${providerAccountId.provider}`
                );
            }
            return user;
        },
    };
}
