'use server';

import { prisma } from '@/lib/prisma';
import { authorizeSecureLink } from '@/lib/linkAuthorization';
import { decryptBuffer, decryptDek } from '@/lib/crypto';
import { downloadFromMongo } from '@/lib/mongo/operations';
import { sendCompletedWorkEmail, type FileAttachment } from '@/lib/email';
import { logger, redactEmail } from '@/lib/logger';

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

        // Check if editing was enabled — only send files via email if editing was allowed
        const isEditingEnabled = (secureLink as any).allowEditing === true;

        let attachments: FileAttachment[] = [];
        let ownerEmail: string | null = null;

        if (isEditingEnabled) {
            // ── EDITING MODE: Decrypt files and email to owner ──

            // 2. Fetch the owner's email for delivery
            const ownerUser = secureLink.ownerId
                ? await prisma.user.findUnique({
                    where: { id: secureLink.ownerId },
                    select: { email: true }
                })
                : null;

            ownerEmail = ownerUser?.email || (secureLink as any).notificationEmail;

            if (!ownerEmail) {
                logger.error('No owner email found — cannot deliver edited files.');
                return { success: false, error: 'Could not determine owner email for file delivery.' };
            }

            // 3. Collect all files and decrypt them for email attachment
            const files = secureLink.UserFile || [];

            // JSON editor state signature as bytes: {"type":"
            const JSON_EDITOR_SIGNATURE = Buffer.from('{"type":"');

            // PERF-3: Decrypt all files in parallel using Promise.allSettled.
            // For links with multiple files, this significantly reduces latency vs sequential.
            // Failed files are logged and skipped — the overall operation continues.
            const fileResults = await Promise.allSettled(
                files.map(async (file) => {
                    let buffer: Buffer | null = null;

                    const hasEncryption = file.iv && file.authTag;

                    if (file.encryptedContent) {
                        // Inline encrypted content (latest draft) — decrypt it
                        const dek = (file as any).encryptedDek
                            ? decryptDek((file as any).encryptedDek)
                            : undefined;
                        buffer = decryptBuffer(
                            file.encryptedContent,
                            file.iv!,
                            file.authTag!,
                            dek
                        );
                        logger.info(`Decrypted inline file ${file.fileName}: ${buffer.length} bytes`);
                    } else if ((file as any).mongoFileId) {
                        // Mongo-backed file — download from GridFS
                        const mongoFile = await prisma.mongoFile.findUnique({
                            where: { id: (file as any).mongoFileId },
                            select: { gridFSId: true, status: true },
                        });

                        if (mongoFile) {
                            const downloadedBuffer = await downloadFromMongo(mongoFile.gridFSId);
                            logger.info(`Downloaded GridFS file ${file.fileName}: ${downloadedBuffer.length} bytes, hasEncryption=${!!hasEncryption}, status=${mongoFile.status}`);

                            if (hasEncryption) {
                                // Original upload was encrypted — decrypt it
                                const dek = (file as any).encryptedDek ? decryptDek((file as any).encryptedDek) : undefined;
                                buffer = decryptBuffer(
                                    downloadedBuffer,
                                    file.iv!,
                                    file.authTag!,
                                    dek
                                );
                            } else {
                                // submitFinal uploads raw unencrypted to GridFS — use as-is
                                buffer = downloadedBuffer;
                            }
                        } else {
                            logger.warn(`MongoFile record not found for ${file.fileName} (mongoFileId: ${(file as any).mongoFileId})`);
                        }
                    } else {
                        logger.warn(`File ${file.fileName} has no content (no encryptedContent, no mongoFileId)`);
                    }

                    if (!buffer) return null;

                    // SAFETY NET: Detect and repair files corrupted by the old JSON.stringify bug.
                    let finalBuffer = buffer;
                    let finalContentType = file.fileType;

                    try {
                        const hasEditorSignature =
                            buffer.length >= JSON_EDITOR_SIGNATURE.length &&
                            buffer.subarray(0, JSON_EDITOR_SIGNATURE.length).equals(JSON_EDITOR_SIGNATURE);

                        if (hasEditorSignature) {
                            const textContent = buffer.toString('utf-8');
                            if (textContent.includes('"pages":[')) {
                                const parsed = JSON.parse(textContent);
                                if (parsed && Array.isArray(parsed.pages)) {
                                    logger.info(`Detected JSON-wrapped editor state for file ${file.fileName} — extracting real content (type: ${parsed.type}, pages: ${parsed.pages.length})`);

                                    if (parsed.type === 'pdf') {
                                        // Dynamic import is safe inside parallel tasks — Node caches the module
                                        const PDFLib = await import('pdf-lib');
                                        const { PDFDocument, rgb, StandardFonts } = PDFLib;
                                        const pdfDoc = await PDFDocument.create();

                                        for (const page of parsed.pages) {
                                            const pdfPage = pdfDoc.addPage([page.width || 794, page.height || 1122]);
                                            pdfPage.drawRectangle({ x: 0, y: 0, width: page.width || 794, height: page.height || 1122, color: rgb(1, 1, 1) });

                                            for (const el of (page.elements || [])) {
                                                if (el.type === 'text') {
                                                    try {
                                                        const font = await pdfDoc.embedFont(el.bold ? StandardFonts.HelveticaBold : StandardFonts.Helvetica);
                                                        const fs = el.size || 12;
                                                        pdfPage.drawText(el.content || '', {
                                                            x: el.x || 0,
                                                            y: Math.max(0, (page.height || 1122) - (el.y || 0) - fs),
                                                            size: fs, font, color: rgb(0, 0, 0),
                                                        });
                                                    } catch { }
                                                } else if (el.type === 'image' && el.src) {
                                                    try {
                                                        const matches = el.src.match(/^data:([^;]+);base64,(.+)$/);
                                                        if (matches) {
                                                            const imgBytes = Buffer.from(matches[2], 'base64');
                                                            const img = matches[1].includes('png')
                                                                ? await pdfDoc.embedPng(imgBytes)
                                                                : await pdfDoc.embedJpg(imgBytes);
                                                            pdfPage.drawImage(img, {
                                                                x: el.x || 0,
                                                                y: (page.height || 1122) - (el.y || 0) - (el.height || 150),
                                                                width: el.width || 200,
                                                                height: el.height || 150,
                                                            });
                                                        }
                                                    } catch { }
                                                } else if (el.type === 'table') {
                                                    try {
                                                        const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
                                                        const { rows = [], colW = 100, rowH = 24 } = el;
                                                        for (let r = 0; r < rows.length; r++) {
                                                            for (let c = 0; c < (rows[r] || []).length; c++) {
                                                                const cx = (el.x || 0) + c * colW;
                                                                const cy = (page.height || 1122) - (el.y || 0) - (r + 1) * rowH;
                                                                pdfPage.drawRectangle({
                                                                    x: cx, y: cy, width: colW, height: rowH,
                                                                    borderColor: rgb(0.7, 0.7, 0.7), borderWidth: 0.5,
                                                                    color: r === 0 ? rgb(0.88, 0.88, 0.95) : rgb(1, 1, 1),
                                                                });
                                                                pdfPage.drawText(String(rows[r][c] || ''), {
                                                                    x: cx + 4, y: cy + 6, size: 9, font, color: rgb(0, 0, 0),
                                                                });
                                                            }
                                                        }
                                                    } catch { }
                                                }
                                            }
                                        }

                                        const pdfBytes = await pdfDoc.save();
                                        finalBuffer = Buffer.from(pdfBytes);
                                        finalContentType = 'application/pdf';

                                    } else if (parsed.type === 'xlsx' || parsed.type === 'xls') {
                                        const { WorkbookAdapter } = await import('@/lib/workbookAdapter');
                                        finalBuffer = await WorkbookAdapter.generateWorkbook(parsed);
                                        finalContentType = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
                                    } else if (parsed.type === 'csv') {
                                        const allRows: any[][] = [];
                                        for (const page of parsed.pages) {
                                            for (const el of (page.elements || [])) {
                                                if (el.type === 'table' && el.rows) {
                                                    allRows.push(...el.rows);
                                                }
                                            }
                                        }
                                        if (allRows.length > 0) {
                                            const XLSXLib = await import('xlsx');
                                            const worksheet = XLSXLib.utils.aoa_to_sheet(allRows);
                                            const csvStr = XLSXLib.utils.sheet_to_csv(worksheet);
                                            finalBuffer = Buffer.from(csvStr, 'utf-8');
                                            finalContentType = 'text/csv';
                                        }
                                    } else if (parsed.type === 'image') {
                                        const imgEl = parsed.pages.flatMap((p: any) => p.elements || []).find((e: any) => e.type === 'image' && e.src);
                                        if (imgEl?.src) {
                                            const matches = imgEl.src.match(/^data:([^;]+);base64,(.+)$/);
                                            if (matches) {
                                                finalBuffer = Buffer.from(matches[2], 'base64');
                                                finalContentType = matches[1];
                                            }
                                        }
                                    } else {
                                        const text = parsed.pages
                                            .flatMap((p: any) => (p.elements || []).filter((e: any) => e.type === 'text').map((e: any) => e.content))
                                            .join('\n');
                                        finalBuffer = Buffer.from(text, 'utf-8');
                                        finalContentType = 'text/plain';
                                    }
                                }
                            }
                        }
                    } catch {
                        // Not JSON or parse failed — use original buffer (correct behavior)
                    }

                    logger.info(`Prepared attachment: ${file.fileName} (${finalBuffer.length} bytes, ${finalContentType})`);
                    return {
                        filename: file.fileName,
                        content: finalBuffer,
                        contentType: finalContentType,
                    } satisfies FileAttachment;
                })
            );

            // Collect successful results; log and skip failed ones
            for (let i = 0; i < fileResults.length; i++) {
                const result = fileResults[i];
                if (result.status === 'fulfilled' && result.value !== null) {
                    attachments.push(result.value);
                } else if (result.status === 'rejected') {
                    logger.error(`Failed to retrieve file ${files[i].id} (${files[i].fileName}):`, result.reason);
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
                    logger.info(`Delivered ${attachments.length} file(s) to owner: ${redactEmail(ownerEmail)}`);
                } catch (emailErr) {
                    logger.error('Email delivery failed:', emailErr);
                    return { success: false, error: 'Failed to deliver files to the owner via email. Please try again. Your work has been saved.' };
                }
            } else {
                logger.info('Editing enabled but no files to deliver.');
            }
        } else {
            // ── DOWNLOAD-ONLY MODE: No email, just revoke access ──
            logger.info('Download-only mode — skipping file delivery email. Revoking access only.');
        }

        // 5. Lock editing on all files — editing is only locked at delivery time
        const fileIds = (secureLink.UserFile || []).map((f: any) => f.id).filter(Boolean);
        if (fileIds.length > 0) {
            await prisma.userFile.updateMany({
                where: { id: { in: fileIds } },
                data: { editingLocked: true } as any,
            });
            logger.info(`Locked editing on ${fileIds.length} file(s).`);
        }

        // 6. Mark the link as revoked
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

            logger.info(`Revoked access for ${redactEmail(lowerEmail)}. VendorAccess: ${revokedVA.count}, LinkAccess: ${revokedLA.count}`);
        } else {
            logger.info(`No specific vendor email found, but marking action.`);
        }

        // 6. Create Audit Log
        await prisma.auditLog.create({
            data: {
                action: 'VENDOR_COMPLETED_WORK',
                linkId: secureLink.id,
                reason: isEditingEnabled
                    ? `Vendor marked work as completed. ${attachments.length} file(s) delivered to owner via email. Link revoked.`
                    : `Vendor marked work as completed. Download-only mode — no files emailed. Link revoked.`,
                metadata: JSON.stringify({
                    completedBy: vendorEmail,
                    mode: isEditingEnabled ? 'editing' : 'download-only',
                    filesDelivered: isEditingEnabled ? attachments.length : 0,
                    deliveredTo: ownerEmail ? ownerEmail.substring(0, 3) + '***' : 'N/A',
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
                logger.error('Failed to invalidate Redis session:', err);
            }
        }

        // 8. AUTO-CLEANUP: Purge ALL data for this link (async, non-blocking)
        import('@/lib/cleanup-core').then(({ executeSingleLinkCleanup }) => {
            executeSingleLinkCleanup(token).catch(err => {
                logger.error('Failed to cleanup link data:', err);
            });
        });

        return { success: true };
    } catch (error) {
        logger.error('completeWork error:', error);
        return { success: false, error: 'Failed to complete work.' };
    }
}
