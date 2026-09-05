import { NextRequest, NextResponse } from 'next/server';
import { decryptBuffer } from '@/lib/crypto';
import { unwrapDek } from '@/lib/security/kms';
import { authorizeSecureLink } from '@/lib/linkAuthorization';
import { downloadLiveObject } from '@/lib/blob-store';
import { logger } from '@/lib/logger';
import { gridFsIdForFile } from '@/lib/security/resource-ownership';
import { checkDownloadRateLimit, checkLinkRateLimit, extractClientIP } from '@/lib/rate-limit';

/**
 * Inline PDF/image preview stream for vendors.
 * Auth: authorizeSecureLink(..., 'preview') — does not require download permission.
 * Client should fetch this as a blob and embed via blob: URL (not iframe this URL directly),
 * because global X-Frame-Options: DENY would block framing the response.
 */
export async function GET(
    _request: NextRequest,
    { params }: { params: Promise<{ token: string; fileId: string }> }
) {
    try {
        const { token, fileId } = await params;

        const ip = extractClientIP(_request.headers);
        const [downloadLimit, linkLimit] = await Promise.all([
            checkDownloadRateLimit(ip),
            checkLinkRateLimit(token),
        ]);
        if (!downloadLimit.allowed || !linkLimit.allowed) {
            return NextResponse.json({ error: 'Too many requests' }, { status: 429 });
        }

        const authResult = await authorizeSecureLink(token, 'preview', fileId);
        if (!authResult.success) {
            return NextResponse.json(
                { error: authResult.error || 'Access denied' },
                { status: authResult.status || 403 }
            );
        }

        const caps = authResult.context.capabilities;
        if (!caps.canPreview) {
            return NextResponse.json({ error: 'Access denied' }, { status: 403 });
        }
        const secureLink = authResult.context.secureLink;
        const { loadUserFileContentForLink } = await import('@/lib/security/resource-ownership');
        const fileRecord = await loadUserFileContentForLink(fileId, secureLink.id);

        if (!fileRecord) {
            return NextResponse.json({ error: 'File not found' }, { status: 404 });
        }

        const mimeType = fileRecord.fileType || 'application/octet-stream';
        const isPreviewable =
            mimeType === 'application/pdf' || mimeType.startsWith('image/');
        if (!isPreviewable) {
            return NextResponse.json(
                { error: 'File type is not stream-previewable' },
                { status: 415 }
            );
        }

        let buffer: Buffer;

        if (fileRecord.encryptedContent) {
            try {
                const dek = fileRecord.encryptedDek
                    ? await unwrapDek(fileRecord.encryptedDek)
                    : undefined;
                buffer = decryptBuffer(
                    fileRecord.encryptedContent,
                    fileRecord.iv!,
                    fileRecord.authTag!,
                    dek
                );
            } catch (e) {
                logger.error('[PREVIEW-STREAM] Inline decrypt failed', e);
                return NextResponse.json({ error: 'Decryption failed' }, { status: 500 });
            }
        } else if (fileRecord.mongoFileId) {
            try {
                const gridFSId = gridFsIdForFile(fileRecord);
                if (!gridFSId) {
                    return NextResponse.json(
                        { error: 'Storage record not found' },
                        { status: 404 }
                    );
                }

                const downloadedBuffer = await downloadLiveObject(gridFSId, fileRecord.fileSize);

                if (fileRecord.iv && fileRecord.authTag) {
                    const dek = fileRecord.encryptedDek
                        ? await unwrapDek(fileRecord.encryptedDek)
                        : undefined;
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
                logger.error('[PREVIEW-STREAM] Mongo retrieve/decrypt failed', e);
                return NextResponse.json(
                    { error: 'Failed to retrieve file for preview' },
                    { status: 500 }
                );
            }
        } else {
            return NextResponse.json(
                { error: 'File has no content available' },
                { status: 404 }
            );
        }

        return new NextResponse(new Uint8Array(buffer), {
            status: 200,
            headers: {
                'Content-Type': mimeType,
                'Content-Length': buffer.length.toString(),
                'Content-Disposition': 'inline',
                'Cache-Control': 'no-store, no-cache, must-revalidate',
                'X-Content-Type-Options': 'nosniff',
            },
        });
    } catch (error) {
        logger.error('[PREVIEW-STREAM] Error:', error);
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
}
