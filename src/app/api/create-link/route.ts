import { NextRequest, NextResponse } from 'next/server';
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
 * JSON (preferred): files already staged → Postgres only.
 * multipart: fallback that encrypts files during this request.
 */
export async function POST(request: NextRequest) {
    warmCreateLinkConnections();

    const contentType = request.headers.get('content-type') || '';
    if (contentType.includes('application/json')) {
        const body = (await request.json()) as CreateLinkJson;
        const result = await createSecureLinkFromJson(body);
        return NextResponse.json(result);
    }

    const formData = await request.formData();
    const result = await createSecureLinkWithFiles(formData);
    return NextResponse.json(result);
}
