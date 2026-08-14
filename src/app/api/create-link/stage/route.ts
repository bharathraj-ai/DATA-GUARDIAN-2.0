import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { canCreateSecureLinks } from '@/lib/security/role-helpers';
import { checkUploadRateLimit, extractClientIP, formatRateLimitError } from '@/lib/rate-limit';
import { headers } from 'next/headers';
import { logger } from '@/lib/logger';
import { isMongoConfigured, isTransientMongoError, mongoFriendlyError, warmMongoConnection } from '@/lib/mongo/client';
import { MAX_SINGLE_FILE_SIZE, stagePlainFile } from '@/lib/create-link-stage';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * Encrypt + GridFS while the owner is still filling the form.
 * Generate then only writes Postgres (~5s) instead of waiting on Atlas again.
 */
export async function POST(request: NextRequest) {
    if (isMongoConfigured()) {
        void warmMongoConnection().catch(() => {});
    }

    const session = await auth();
    if (!session?.user?.id) {
        return NextResponse.json({ success: false, error: 'Authentication required.' }, { status: 401 });
    }
    if (!canCreateSecureLinks(session.user.role)) {
        return NextResponse.json({ success: false, error: 'You do not have permission to upload files.' }, { status: 403 });
    }

    const requestHeaders = await headers();
    const rateLimit = await checkUploadRateLimit(extractClientIP(requestHeaders));
    if (!rateLimit.allowed) {
        return NextResponse.json({ success: false, error: formatRateLimitError(rateLimit) }, { status: 429 });
    }

    const encodedName = request.headers.get('x-file-name') || '';
    let fileName = 'upload';
    try {
        fileName = decodeURIComponent(encodedName) || 'upload';
    } catch {
        return NextResponse.json({ success: false, error: 'Invalid filename.' }, { status: 400 });
    }

    const buf = Buffer.from(await request.arrayBuffer());
    if (buf.length === 0) {
        return NextResponse.json({ success: false, error: 'Empty file.' }, { status: 400 });
    }
    if (buf.length > MAX_SINGLE_FILE_SIZE) {
        return NextResponse.json({ success: false, error: `File "${fileName}" exceeds 15MB limit.` }, { status: 400 });
    }

    try {
        const staged = await stagePlainFile({
            buffer: buf,
            fileName,
            uploadedBy: session.user.id,
        });
        return NextResponse.json({ success: true, gridFSId: staged.gridFSId });
    } catch (error) {
        const message = mongoFriendlyError(error);
        const transient = isTransientMongoError(error);
        logger.warn('[create-link/stage] upload failed', {
            transient,
            message: error instanceof Error ? error.message : String(error),
        });
        return NextResponse.json(
            { success: false, error: message },
            { status: transient ? 503 : 400 },
        );
    }
}
