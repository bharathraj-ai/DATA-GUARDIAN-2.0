'use server';

import { prisma } from '@/lib/prisma';
import { authorizeSecureLink } from '@/lib/linkAuthorization';
import { decryptBuffer, decryptDek } from '@/lib/crypto';
import { downloadFromMongo } from '@/lib/mongo/operations';
import { sendCompletedWorkEmail, type FileAttachment } from '@/lib/email';

export type CompleteWorkResult = {
    success: boolean;
    error?: string;
};

export async function completeWork(token: string): Promise<CompleteWorkResult> {
    try {
        // 1. Authorize (Must have view capability at least)
        const authResult = await authorizeSecureLink(token, 'view');
        if (!authResult.success) {
            return { success: false, error: authResult.error };
        }

        const vendorEmail = authResult.context.effectiveEmail || 'unknown';
        const secureLink = authResult.context.secureLink;

        // 2. Fetch the owner's email and link purpose for the delivery email
        const ownerUser = secureLink.ownerId
            ? await prisma.user.findUnique({
                where: { id: secureLink.ownerId },
                select: { email: true }
            })
            : null;

        const ownerEmail = ownerUser?.email || (secureLink as any).notificationEmail;

        if (!ownerEmail) {
            console.error('[Complete Work] No owner email found — cannot deliver files.');
            return { success: false, error: 'Could not determine owner email for file delivery.' };
        }

        // 3. Collect all files and decrypt them for email attachment
        const files = secureLink.UserFile || [];
        const attachments: FileAttachment[] = [];

        for (const file of files) {
            try {
                let buffer: Buffer | null = null;

                if (file.encryptedContent) {
                    // Inline encrypted content — decrypt it
                    const dek = (file as any).encryptedDek
                        ? decryptDek((file as any).encryptedDek)
                        : undefined;
                    buffer = decryptBuffer(
                        file.encryptedContent,
                        file.iv!,
                        file.authTag!,
                        dek
                    );
                } else if ((file as any).mongoFileId) {
                    // Mongo-backed file — download from GridFS
                    const mongoFile = await prisma.mongoFile.findUnique({
                        where: { id: (file as any).mongoFileId },
                        select: { gridFSId: true },
                    });

                    if (mongoFile) {
                        const encryptedBuffer = await downloadFromMongo(mongoFile.gridFSId);
                        const dek = (file as any).encryptedDek ? decryptDek((file as any).encryptedDek) : undefined;
                        buffer = decryptBuffer(
                            encryptedBuffer,
                            file.iv!,
                            file.authTag!,
                            dek
                        );
                    }
                }

                if (buffer) {
                    attachments.push({
                        filename: file.fileName,
                        content: buffer,
                        contentType: file.fileType,
                    });
                }
            } catch (err) {
                console.error(`[Complete Work] Failed to retrieve file ${file.id}:`, err);
                // Continue with other files — don't fail the entire operation
            }
        }

        // 4. Send email with attachments to owner
        if (attachments.length > 0) {
            try {
                await sendCompletedWorkEmail(
                    ownerEmail,
                    vendorEmail,
                    (secureLink as any).purpose || '',
                    attachments
                );
                console.log(`[Complete Work] Delivered ${attachments.length} file(s) to owner: ${ownerEmail.substring(0, 3)}***`);
            } catch (emailErr) {
                console.error('[Complete Work] Email delivery failed:', emailErr);
                // Don't block the revocation — the files are still in DB if email fails
                // Owner can still access them before cleanup runs
            }
        } else {
            console.log('[Complete Work] No files to deliver.');
        }

        // 5. Mark the link as revoked
        await prisma.secureLink.update({
            where: { id: secureLink.id },
            data: { isRevoked: true }
        });

        if (vendorEmail !== 'unknown') {
            const lowerEmail = vendorEmail.toLowerCase();

            // Revoke VendorAccess
            const revokedVA = await prisma.vendorAccess.updateMany({
                where: {
                    secureLinkId: secureLink.id,
                    email: { mode: 'insensitive', equals: lowerEmail }
                },
                data: { isRevoked: true }
            });

            // Revoke LinkAccess
            const revokedLA = await prisma.linkAccess.updateMany({
                where: {
                    secureLinkId: secureLink.id,
                    vendorEmail: { mode: 'insensitive', equals: lowerEmail }
                },
                data: { isUsed: false }
            });

            console.log(`[Complete Work] Revoked access for ${lowerEmail}. VendorAccess: ${revokedVA.count}, LinkAccess: ${revokedLA.count}`);
        } else {
            console.log(`[Complete Work] No specific vendor email found, but marking action.`);
        }

        // 6. Create Audit Log
        await prisma.auditLog.create({
            data: {
                action: 'VENDOR_COMPLETED_WORK',
                linkId: secureLink.id,
                reason: `Vendor marked work as completed. ${attachments.length} file(s) delivered to owner via email. Link revoked.`,
                metadata: JSON.stringify({
                    completedBy: vendorEmail,
                    filesDelivered: attachments.length,
                    deliveredTo: ownerEmail.substring(0, 3) + '***',
                })
            }
        });

        // 7. Invalidate Redis session if configured
        const isRedisConfigured = !!(
            process.env.UPSTASH_REDIS_REST_URL &&
            process.env.UPSTASH_REDIS_REST_TOKEN &&
            !process.env.UPSTASH_REDIS_REST_URL.includes('your-redis')
        );

        if (isRedisConfigured) {
            try {
                const { invalidateSession } = await import('@/lib/redis');
                await invalidateSession(token, true);
            } catch (err) {
                console.error('[Complete Work] Failed to invalidate Redis session:', err);
            }
        }

        // 8. AUTO-CLEANUP: Purge ALL data for this link (async, non-blocking)
        import('@/actions/cleanup').then(({ cleanupSingleLink }) => {
            cleanupSingleLink(token).catch(err => {
                console.error('[Complete Work] Failed to cleanup link data:', err);
            });
        });

        return { success: true };
    } catch (error) {
        console.error('completeWork error:', error);
        return { success: false, error: 'Failed to complete work.' };
    }
}
