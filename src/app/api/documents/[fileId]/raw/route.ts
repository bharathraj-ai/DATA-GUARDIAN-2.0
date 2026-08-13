import { NextRequest, NextResponse } from 'next/server';
import { authorizeApiRequest } from '@/lib/api-auth';
import { decryptUserFileBytes } from '@/lib/decrypt-user-file';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/documents/[fileId]/raw?token=<shareToken>
 * Decrypts server-side and returns raw bytes (not base64) for the editor.
 */
export async function GET(
    req: NextRequest,
    { params }: { params: Promise<{ fileId: string }> },
) {
    try {
        const { fileId } = await params;
        const token = req.nextUrl.searchParams.get('token');
        if (!token) {
            return NextResponse.json({ error: 'Missing token' }, { status: 401 });
        }

        const authResult = await authorizeApiRequest(fileId, token, {
            httpMethod: req.method,
            action: 'edit',
            includeContent: true,
        });
        if (authResult.errorResponse) return authResult.errorResponse;

        const file = authResult.file;
        if (!file) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const bytes = await decryptUserFileBytes(file);
        const fileName = file.fileName || 'document';
        const mime = file.fileType || 'application/octet-stream';
        const remainingSeconds = Math.max(
            0,
            Math.floor((authResult.secureLink.expiresAt.getTime() - Date.now()) / 1000),
        );
        const caps = authResult.capabilities;

        return new NextResponse(new Uint8Array(bytes), {
            status: 200,
            headers: {
                'Content-Type': mime,
                'Content-Length': String(bytes.length),
                'Content-Disposition': `inline; filename*=UTF-8''${encodeURIComponent(fileName)}`,
                'Cache-Control': 'no-store, no-cache, must-revalidate',
                'X-File-Name': encodeURIComponent(fileName),
                'X-File-Version': String(file.version ?? 1),
                'X-My-Level': String(authResult.level ?? 2),
                'X-Remaining-Seconds': String(remainingSeconds),
                'X-Can-Edit': caps.canEdit ? '1' : '0',
                'X-Can-Preview': caps.canPreview ? '1' : '0',
                'X-Can-Comment': caps.canComment ? '1' : '0',
                'X-Can-Download': caps.canDownload ? '1' : '0',
            },
        });
    } catch (err) {
        console.error('[raw] decrypt error:', err);
        return NextResponse.json({ error: 'Failed to decrypt file' }, { status: 500 });
    }
}
