import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { extractClientIP, checkGlobalRateLimit } from '@/lib/rate-limit';
import { cookies } from 'next/headers';
import { auth } from '@/lib/auth';
import { decryptData } from '@/lib/crypto';
import { verifyShareSession } from '@/lib/share-session';

/**
 * Presence heartbeat — identity and level are derived server-side.
 * Client-supplied vendorEmail/level are ignored.
 */
export async function POST(req: NextRequest) {
    try {
        const ip = extractClientIP(req.headers);
        const rl = await checkGlobalRateLimit(ip);
        if (!rl.allowed) {
            return NextResponse.json({ error: 'Too many requests' }, { status: 429 });
        }

        const body = await req.json();
        const { token, displayName, fileId } = body as {
            token?: string;
            displayName?: string;
            fileId?: string;
            vendorEmail?: string;
            level?: number;
        };

        if (!token || typeof token !== 'string') {
            return NextResponse.json({ error: 'Missing token' }, { status: 400 });
        }

        const cookieStore = await cookies();
        const verified = verifyShareSession(cookieStore.get('session_id')?.value, token);
        if (!verified.valid) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const link = await prisma.secureLink.findUnique({
            where: { token },
            select: {
                id: true,
                isRevoked: true,
                expiresAt: true,
                ownerId: true,
                allowedVendorEmail: true,
                VendorAccess: { select: { email: true, level: true, isRevoked: true } },
                LinkAccess: { select: { vendorEmail: true, level: true, lockedAt: true } },
            },
        });
        if (!link || link.isRevoked || link.expiresAt < new Date()) {
            return NextResponse.json({ error: 'Invalid token' }, { status: 403 });
        }

        const session = await auth();
        const sessionEmail = session?.user?.email?.trim().toLowerCase() || null;

        const rawCookie = cookieStore.get('vendor_email')?.value;
        let cookieEmail: string | null = null;
        if (rawCookie) {
            try {
                cookieEmail = decryptData<{ email: string }>(rawCookie).email.trim().toLowerCase();
            } catch {
                cookieEmail = rawCookie.includes(':') ? null : rawCookie.trim().toLowerCase();
            }
        }

        const effectiveEmail = cookieEmail || sessionEmail;
        if (!effectiveEmail) {
            return NextResponse.json({ error: 'Forbidden: Identity required' }, { status: 403 });
        }

        const isOwner = Boolean(session?.user?.id && session.user.id === link.ownerId);
        let level = 2;

        if (isOwner) {
            level = 1;
        } else {
            const vendor = link.VendorAccess.find(
                (v) => v.email.toLowerCase() === effectiveEmail && !v.isRevoked,
            );
            const access = link.LinkAccess.find(
                (a) => a.vendorEmail.toLowerCase() === effectiveEmail && !a.lockedAt,
            );
            const allowed =
                (link.allowedVendorEmail && link.allowedVendorEmail.toLowerCase() === effectiveEmail) ||
                Boolean(vendor) ||
                Boolean(access) ||
                (link.VendorAccess.length === 0 && link.LinkAccess.length === 0 && !link.allowedVendorEmail);

            if (!allowed) {
                return NextResponse.json({ error: 'Forbidden: Identity mismatch' }, { status: 403 });
            }
            level = vendor?.level ?? access?.level ?? 2;
        }

        const safeFileId =
            typeof fileId === 'string' && fileId.length > 0 && fileId !== 'N/A' ? fileId : 'presence';

        // If a real fileId is provided, ensure it belongs to this link
        if (safeFileId !== 'presence') {
            const owned = await prisma.userFile.findFirst({
                where: { id: safeFileId, secureLinkId: link.id },
                select: { id: true },
            });
            if (!owned) {
                return NextResponse.json({ error: 'Forbidden: File not on this link' }, { status: 403 });
            }
        }

        const docSessionId = `${token}_${Buffer.from(effectiveEmail).toString('base64').substring(0, 20)}`;
        const name =
            (typeof displayName === 'string' && displayName.trim().slice(0, 64)) ||
            effectiveEmail.split('@')[0];

        await prisma.documentSession.upsert({
            where: { id: docSessionId },
            update: {
                lastSeenAt: new Date(),
                level,
                displayName: name,
                fileId: safeFileId,
                userId: effectiveEmail,
            },
            create: {
                id: docSessionId,
                token,
                fileId: safeFileId,
                userId: effectiveEmail,
                level,
                displayName: name,
                lastSeenAt: new Date(),
            },
        });

        return NextResponse.json({ success: true, email: effectiveEmail, level });
    } catch (error) {
        console.error('Heartbeat Error:', error);
        return NextResponse.json({ error: 'Failed to update heartbeat' }, { status: 500 });
    }
}
