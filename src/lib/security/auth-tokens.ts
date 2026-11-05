import crypto from 'crypto';
import { prisma } from '@/lib/prisma';
import { hashPassword, validatePasswordStrength } from '@/lib/security/password';
import { logger, redactEmail } from '@/lib/logger';
import { revokeAllUserSessions } from '@/lib/security/user-session-revocation';
import { sendPasswordChangedNotificationEmail } from '@/lib/email';

const VERIFICATION_TOKEN_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
const PASSWORD_RESET_TOKEN_TTL_MS = 60 * 60 * 1000;    // 1 hour

/**
 * Generate a cryptographically secure random token (256-bit entropy).
 */
export function generateSecureToken(): { token: string; hash: string } {
    const token = crypto.randomBytes(32).toString('hex');
    const hash = hashToken(token);
    return { token, hash };
}

/**
 * Compute SHA-256 hash of an authentication token.
 * Only the hash is ever stored in the database.
 */
export function hashToken(token: string): string {
    return crypto.createHash('sha256').update(token).digest('hex');
}

/**
 * Create a new email verification token for a given email address.
 * Deletes any pending verification tokens for this email to prevent reuse.
 * Returns the unhashed token to be sent in the email.
 */
export async function createEmailVerificationToken(email: string): Promise<string> {
    const normalizedEmail = email.trim().toLowerCase();
    const { token, hash } = generateSecureToken();
    const expiresAt = new Date(Date.now() + VERIFICATION_TOKEN_TTL_MS);

    await prisma.$transaction(async (tx) => {
        // Invalidate previous tokens
        await tx.emailVerificationToken.deleteMany({
            where: { email: normalizedEmail },
        });

        // Store only the token hash
        await tx.emailVerificationToken.create({
            data: {
                email: normalizedEmail,
                tokenHash: hash,
                expiresAt,
            },
        });
    });

    logger.info(`[Auth Tokens] Generated verification token for email=${redactEmail(normalizedEmail)}`);
    return token;
}

/**
 * Verify an email verification token securely and mark the user's email as verified.
 * The token is consumed/invalidated immediately in a transaction to prevent reuse.
 */
export async function verifyEmailVerificationToken(token: string): Promise<{
    success: boolean;
    email?: string;
    error?: string;
}> {
    if (!token || typeof token !== 'string') {
        return { success: false, error: 'Invalid verification token format' };
    }

    const tokenHash = hashToken(token.trim());

    try {
        const result = await prisma.$transaction(async (tx) => {
            const tokenRecord = await tx.emailVerificationToken.findUnique({
                where: { tokenHash },
            });

            if (!tokenRecord) {
                return { success: false, error: 'Invalid or expired verification token' };
            }

            if (tokenRecord.expiresAt < new Date()) {
                // Token has expired — clean it up
                await tx.emailVerificationToken.deleteMany({
                    where: { email: tokenRecord.email },
                });
                return { success: false, error: 'Verification token has expired. Please request a new one.' };
            }

            // Mark user's email as verified
            const user = await tx.user.findUnique({
                where: { email: tokenRecord.email },
            });

            if (!user) {
                return { success: false, error: 'Account not found' };
            }

            await tx.user.update({
                where: { id: user.id },
                data: { emailVerified: new Date() },
            });

            // Invalidate the token (and all pending tokens for this email) to prevent replay
            await tx.emailVerificationToken.deleteMany({
                where: { email: tokenRecord.email },
            });

            return { success: true, email: tokenRecord.email };
        });

        if (result.success && result.email) {
            logger.info(`[Auth Tokens] Email successfully verified email=${redactEmail(result.email)}`);
        }

        return result;
    } catch (err) {
        logger.error('[Auth Tokens] Error verifying email token', err);
        return { success: false, error: 'Failed to verify email. Please try again.' };
    }
}

/**
 * Create a password reset token for a registered email.
 * If the user does not exist, returns null without revealing existence to the client.
 */
export async function createPasswordResetToken(email: string): Promise<string | null> {
    const normalizedEmail = email.trim().toLowerCase();
    const user = await prisma.user.findUnique({
        where: { email: normalizedEmail },
        select: { id: true, email: true },
    });

    if (!user) {
        // Return null — caller must still report generic success to prevent account enumeration
        return null;
    }

    const { token, hash } = generateSecureToken();
    const expiresAt = new Date(Date.now() + PASSWORD_RESET_TOKEN_TTL_MS);

    await prisma.$transaction(async (tx) => {
        // Invalidate existing reset tokens for this email
        await tx.passwordResetToken.deleteMany({
            where: { email: normalizedEmail },
        });

        // Store only the token hash
        await tx.passwordResetToken.create({
            data: {
                email: normalizedEmail,
                tokenHash: hash,
                expiresAt,
            },
        });
    });

    logger.info(`[Auth Tokens] Generated password reset token for email=${redactEmail(normalizedEmail)}`);
    return token;
}

/**
 * Verify a password reset token and update the user's password.
 * Consumes the token and invalidates active sessions.
 */
export async function verifyAndConsumePasswordResetToken(
    token: string,
    newPlainPassword: string
): Promise<{ success: boolean; error?: string }> {
    if (!token || typeof token !== 'string') {
        return { success: false, error: 'Invalid reset token format' };
    }

    const strength = validatePasswordStrength(newPlainPassword);
    if (!strength.isValid) {
        return { success: false, error: strength.errors[0] || 'Password does not meet security requirements' };
    }

    const tokenHash = hashToken(token.trim());

    try {
        const result = await prisma.$transaction(async (tx) => {
            const tokenRecord = await tx.passwordResetToken.findUnique({
                where: { tokenHash },
            });

            if (!tokenRecord) {
                return { success: false, error: 'Invalid or expired password reset link' };
            }

            if (tokenRecord.expiresAt < new Date()) {
                await tx.passwordResetToken.deleteMany({
                    where: { email: tokenRecord.email },
                });
                return { success: false, error: 'Password reset link has expired. Please request a new one.' };
            }

            const user = await tx.user.findUnique({
                where: { email: tokenRecord.email },
            });

            if (!user) {
                return { success: false, error: 'Account not found' };
            }

            const newPasswordHash = await hashPassword(newPlainPassword);

            // Update user password and ensure email is marked verified
            await tx.user.update({
                where: { id: user.id },
                data: {
                    passwordHash: newPasswordHash,
                    emailVerified: user.emailVerified || new Date(),
                },
            });

            // Invalidate all reset tokens for this user
            await tx.passwordResetToken.deleteMany({
                where: { email: tokenRecord.email },
            });

            // Invalidate any database sessions to enforce re-login
            await tx.session.deleteMany({
                where: { userId: user.id },
            });

            // Invalidate all active stateless JWT sessions for this user across all devices
            await revokeAllUserSessions(user.id);

            return { success: true, email: user.email };
        });

        if (result.success && result.email) {
            logger.info(`[Auth Tokens] Password successfully reset for token hash=${tokenHash.slice(0, 10)}...`);
            sendPasswordChangedNotificationEmail(result.email, 'changed').catch((err) => {
                logger.warn('[Auth Tokens] Failed to send password reset notification email', err);
            });
        }

        return { success: result.success, error: result.error };
    } catch (err) {
        logger.error('[Auth Tokens] Error resetting password', err);
        return { success: false, error: 'Failed to reset password. Please try again.' };
    }
}

