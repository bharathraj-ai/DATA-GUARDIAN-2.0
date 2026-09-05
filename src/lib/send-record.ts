import { prisma } from '@/lib/prisma';
import { logger } from '@/lib/logger';
import { Prisma } from '@prisma/client';

export type SendRecordStatus =
    | 'active'
    | 'expired'
    | 'revoked'
    | 'cleaned'
    | 'completed'
    | 'suspicious';

export function normalizeVendorEmail(email: string | null | undefined): string {
    return (email || '').trim().toLowerCase();
}

/** Split a stored vendor field into individual emails (legacy comma lists included). */
export function parseVendorEmails(value: string | null | undefined): string[] {
    if (!value) return [];
    return value
        .split(/[,;]/)
        .map((part) => normalizeVendorEmail(part))
        .filter((part) => part.includes('@'));
}

/** Exact, case-insensitive match — never `contains` (avoids suffix IDOR). */
export function vendorEmailEqualsWhere(email: string): Prisma.SendRecordWhereInput {
    const normalized = normalizeVendorEmail(email);
    return {
        vendorEmail: { equals: normalized, mode: 'insensitive' },
    };
}

/**
 * Stamp the surviving SendRecord for a share. These rows outlive SecureLink
 * deletion so owner/vendor dashboards can still show real history.
 */
export async function stampSendRecord(options: {
    ownerId: string | null | undefined;
    purpose?: string | null;
    vendorEmail?: string | null;
    status: Exclude<SendRecordStatus, 'active'>;
}): Promise<void> {
    const ownerId = options.ownerId;
    if (!ownerId) return;

    const emails = parseVendorEmails(options.vendorEmail);
    const purpose = options.purpose ?? '';

    try {
        if (emails.length === 0) {
            await prisma.sendRecord.updateMany({
                where: { ownerId, status: 'active', ...(purpose ? { topic: purpose } : {}) },
                data: { status: options.status, expiredAt: new Date() },
            });
            return;
        }

        for (const vendorEmail of emails) {
            const match = await prisma.sendRecord.findFirst({
                where: {
                    ownerId,
                    status: 'active',
                    ...(purpose ? { topic: purpose } : {}),
                    ...vendorEmailEqualsWhere(vendorEmail),
                },
                orderBy: { createdAt: 'desc' },
                select: { id: true },
            });

            if (match) {
                await prisma.sendRecord.update({
                    where: { id: match.id },
                    data: { status: options.status, expiredAt: new Date() },
                });
            }
        }
    } catch (err) {
        logger.warn(
            '[send-record] stamp failed',
            err instanceof Error ? err.message : 'Unknown',
        );
    }
}
