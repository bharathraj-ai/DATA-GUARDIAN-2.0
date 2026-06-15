import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { decryptBuffer, decryptDek } from '@/lib/crypto';
import { authorizeSecureLink } from '@/lib/linkAuthorization';
import { downloadFromMongo } from '@/lib/mongo/operations';
import { extractRequestInfo } from '@/lib/security/auditLog';
import { logger } from '@/lib/logger';

export async function GET(
    request: NextRequest,
    { params }: { params: Promise<{ token: string; fileId: string }> }
) {
    try {
        const { token, fileId } = await params;

        // ── 1. Authorization Check ─────────────────────────────────
        const authResult = await authorizeSecureLink(token, 'download', fileId);
        if (!authResult.success) {
            return NextResponse.json(
                { error: authResult.error || 'Access denied' },
                { status: authResult.status || 403 }
            );
        }

        const secureLink = authResult.context.secureLink;
        const fileRecord = secureLink.UserFile.find((f) => f.id === fileId);

        if (!fileRecord) {
            return NextResponse.json(
                { error: 'File not found' },
                { status: 404 }
            );
        }

        // ── 2. Retrieve and Decrypt File ───────────────────────────
        let buffer: Buffer;

        // Priority: inline encrypted content (draft saves) → GridFS (original upload)
        if (fileRecord.encryptedContent) {
            try {
                const dek = fileRecord.encryptedDek ? decryptDek(fileRecord.encryptedDek) : undefined;
                buffer = decryptBuffer(
                    fileRecord.encryptedContent,
                    fileRecord.iv!,
                    fileRecord.authTag!,
                    dek
                );
            } catch (e) {
                logger.error('[DOWNLOAD] Decryption failed for inline content', e);
                return NextResponse.json(
                    { error: 'Decryption failed' },
                    { status: 500 }
                );
            }
        } else if (fileRecord.mongoFileId) {
            try {
                const mongoFileRecord = await prisma.mongoFile.findUnique({
                    where: { id: fileRecord.mongoFileId, isDeleted: false },
                    select: { gridFSId: true, mimeType: true },
                });

                if (!mongoFileRecord) {
                    return NextResponse.json(
                        { error: 'Storage record not found' },
                        { status: 404 }
                    );
                }

                const downloadedBuffer = await downloadFromMongo(mongoFileRecord.gridFSId);

                if (fileRecord.iv && fileRecord.authTag) {
                    const dek = fileRecord.encryptedDek ? decryptDek(fileRecord.encryptedDek) : undefined;
                    buffer = decryptBuffer(
                        downloadedBuffer,
                        fileRecord.iv,
                        fileRecord.authTag,
                        dek
                    );
                } else {
                    buffer = downloadedBuffer;
                }
            } catch (e) {
                logger.error('[DOWNLOAD] Mongo retrieval/decryption failed', e);
                return NextResponse.json(
                    { error: 'Failed to retrieve or decrypt file from storage' },
                    { status: 500 }
                );
            }
        } else {
            return NextResponse.json(
                { error: 'File has no content available' },
                { status: 404 }
            );
        }

        // ── 3. Audit Logging ───────────────────────────────────────
        try {
            const { ipAddress, userAgent } = extractRequestInfo(request);
            await prisma.auditLog.create({
                data: {
                    action: 'VENDOR_DOWNLOADED_FILE',
                    linkId: secureLink.id,
                    metadata: JSON.stringify({
                        fileId,
                        fileName: fileRecord.fileName,
                        ipAddress,
                        userAgent,
                        token,
                    }),
                },
            });
        } catch (logError) {
            logger.warn('Failed to log download event:', logError);
        }

        // ── 4. Return File Stream ──────────────────────────────────
        const disposition = `attachment; filename="${encodeURIComponent(fileRecord.fileName)}"`;
        const mimeType = fileRecord.fileType || 'application/octet-stream';

        return new NextResponse(new Uint8Array(buffer), {
            status: 200,
            headers: {
                'Content-Type': mimeType,
                'Content-Length': buffer.length.toString(),
                'Content-Disposition': disposition,
                'Cache-Control': 'no-store, no-cache, must-revalidate',
                'X-Content-Type-Options': 'nosniff',
                'X-Frame-Options': 'DENY',
            },
        });
    } catch (error) {
        logger.error('[DOWNLOAD] Error streaming document:', error);
        return NextResponse.json(
            { error: 'Internal server error' },
            { status: 500 }
        );
    }
}
