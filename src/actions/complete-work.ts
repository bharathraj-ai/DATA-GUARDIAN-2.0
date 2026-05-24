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
                    console.log(`[Complete Work] Decrypted inline file ${file.fileName}: ${buffer.length} bytes`);
                } else if ((file as any).mongoFileId) {
                    // Mongo-backed file — download from GridFS
                    const mongoFile = await prisma.mongoFile.findUnique({
                        where: { id: (file as any).mongoFileId },
                        select: { gridFSId: true, status: true },
                    });

                    if (mongoFile) {
                        const downloadedBuffer = await downloadFromMongo(mongoFile.gridFSId);
                        console.log(`[Complete Work] Downloaded GridFS file ${file.fileName}: ${downloadedBuffer.length} bytes, hasEncryption=${!!hasEncryption}, status=${mongoFile.status}`);

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
                        console.warn(`[Complete Work] MongoFile record not found for ${file.fileName} (mongoFileId: ${(file as any).mongoFileId})`);
                    }
                } else {
                    console.warn(`[Complete Work] File ${file.fileName} has no content (no encryptedContent, no mongoFileId)`);
                }

                if (buffer) {
                    // SAFETY NET: Detect and repair files corrupted by the old JSON.stringify bug.
                    // Previously, the editor saved its internal state (pages/elements/coordinates)
                    // as JSON instead of proper file content. This detects that pattern and
                    // extracts the actual content from the JSON wrapper.
                    let finalBuffer = buffer;
                    let finalContentType = file.fileType;

                    try {
                        const textContent = buffer.toString('utf-8');
                        // Only attempt JSON parse for text-like MIME types or small files
                        // that could plausibly be wrapped editor state
                        if (textContent.startsWith('{"type":"') && textContent.includes('"pages":[')) {
                            const parsed = JSON.parse(textContent);
                            if (parsed && Array.isArray(parsed.pages)) {
                                console.warn(`[Complete Work] Detected JSON-wrapped editor state for file ${file.fileName} — extracting real content (type: ${parsed.type}, pages: ${parsed.pages.length})`);

                                // Extract content in the SAME format the owner originally uploaded
                                if (parsed.type === 'pdf') {
                                    // PDF: render all pages with all elements
                                    const { PDFDocument, rgb, StandardFonts } = await import('pdf-lib');
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

                                } else if (parsed.type === 'csv' || parsed.type === 'xlsx' || parsed.type === 'xls') {
                                    // Spreadsheet: extract ALL table rows from ALL pages
                                    const allRows: any[][] = [];
                                    for (const page of parsed.pages) {
                                        for (const el of (page.elements || [])) {
                                            if (el.type === 'table' && el.rows) {
                                                allRows.push(...el.rows);
                                            }
                                        }
                                    }
                                    if (allRows.length > 0) {
                                        const XLSX = await import('xlsx');
                                        const worksheet = XLSX.utils.aoa_to_sheet(allRows);
                                        if (parsed.type === 'csv') {
                                            const csvStr = XLSX.utils.sheet_to_csv(worksheet);
                                            finalBuffer = Buffer.from(csvStr, 'utf-8');
                                            finalContentType = 'text/csv';
                                        } else {
                                            const workbook = XLSX.utils.book_new();
                                            XLSX.utils.book_append_sheet(workbook, worksheet, 'Sheet1');
                                            const buf = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
                                            finalBuffer = Buffer.from(buf);
                                            finalContentType = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
                                        }
                                    }
                                } else if (parsed.type === 'image') {
                                    // Image: extract image binary from base64 data URL
                                    const imgEl = parsed.pages.flatMap((p: any) => p.elements || []).find((e: any) => e.type === 'image' && e.src);
                                    if (imgEl?.src) {
                                        const matches = imgEl.src.match(/^data:([^;]+);base64,(.+)$/);
                                        if (matches) {
                                            finalBuffer = Buffer.from(matches[2], 'base64');
                                            finalContentType = matches[1];
                                        }
                                    }
                                } else {
                                    // Text (TXT and other): join ALL text elements across ALL pages
                                    const text = parsed.pages
                                        .flatMap((p: any) => (p.elements || []).filter((e: any) => e.type === 'text').map((e: any) => e.content))
                                        .join('\n');
                                    finalBuffer = Buffer.from(text, 'utf-8');
                                    finalContentType = 'text/plain';
                                }
                            }
                        }
                    } catch {
                        // Not JSON or parse failed — use original buffer (correct behavior)
                    }

                    attachments.push({
                        filename: file.fileName,
                        content: finalBuffer,
                        contentType: finalContentType,
                    });
                    console.log(`[Complete Work] Prepared attachment: ${file.fileName} (${finalBuffer.length} bytes, ${finalContentType})`);
                }
            } catch (err) {
                console.error(`[Complete Work] Failed to retrieve file ${file.id} (${file.fileName}):`, err);
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
