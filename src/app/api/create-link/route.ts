import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { requireOwnerRole } from '@/lib/security/roles';
import { checkUploadRateLimit, extractClientIP, formatRateLimitError } from '@/lib/rate-limit';
import { headers } from 'next/headers';
import { createSecureLinkFromJson, createSecureLinkWithFiles } from '@/actions/create-link-with-files';
import { isMongoConfigured, warmMongoConnection } from '@/lib/mongo/client';
import { warmEmailTransport } from '@/lib/email';
import { warmPrismaConnection } from '@/lib/prisma';
import type { CreateLinkJson } from '@/lib/create-link-payload';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

function warmCreateLinkConnections() {
    if (isMongoConfigured()) {
        void warmMongoConnection().catch(() => {});
    }
    warmPrismaConnection();
    warmEmailTransport();
}

/** Cheap ping from the form page so TLS/DB sockets are hot before Generate. */
export async function GET() {
    warmCreateLinkConnections();
    return new NextResponse(null, { status: 204 });
}

/**
 * POST /api/create-link (SV-03)
 *
 * Flow:
 *   1. Authenticate user session (401 if missing)
 *   2. Authorize user against PostgreSQL role (403 if not OWNER)
 *   3. Rate limit check (429 if exceeded)
 *   4. JSON (preferred): files already staged → Postgres only.
 *      multipart: fallback that encrypts files during this request.
 */
export async function POST(request: NextRequest) {
    warmCreateLinkConnections();

    // ── 1. Authentication check ──────────────────────────────────
    const session = await auth();
    if (!session?.user?.id) {
        return NextResponse.json(
            { success: false, error: 'Authentication required' },
            { status: 401 }
        );
    }

    // ── 2. Authorization check (PostgreSQL DB role — never JWT) ───
    const isOwner = await requireOwnerRole(session.user.id);
    if (!isOwner) {
        return NextResponse.json(
            { success: false, error: 'You do not have permission to create secure links' },
            { status: 403 }
        );
    }

    // ── 3. Rate Limit check ──────────────────────────────────────
    const requestHeaders = await headers();
    const clientIP = extractClientIP(requestHeaders);
    const rateLimit = await checkUploadRateLimit(clientIP);
    if (!rateLimit.allowed) {
        return NextResponse.json(
            { success: false, error: formatRateLimitError(rateLimit) },
            { status: 429 }
        );
    }

    // ── 4. Process Request ───────────────────────────────────────
    const contentType = request.headers.get('content-type') || '';
    if (contentType.includes('application/json')) {
        const body = (await request.json()) as CreateLinkJson;
        const result = await createSecureLinkFromJson(body);
        if (!result.success) {
            const status = result.error?.includes('Authentication') ? 401
                : result.error?.includes('permission') ? 403
                : 400;
            return NextResponse.json(result, { status });
        }
        return NextResponse.json(result);
    }

    const formData = await request.formData();
    const result = await createSecureLinkWithFiles(formData);
    if (!result.success) {
        const status = result.error?.includes('Authentication') ? 401
            : result.error?.includes('permission') ? 403
            : 400;
        return NextResponse.json(result, { status });
    }
    return NextResponse.json(result);
}
