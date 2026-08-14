import { prisma } from '@/lib/prisma';
import { logger } from '@/lib/logger';

export type SendRecordStatus =
    | 'active'
    | 'expired'
    | 'revoked'
    | 'cleaned'
    | 'completed'
    | 'suspicious';

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

    const vendorEmail = (options.vendorEmail || '').trim().toLowerCase();
    const purpose = options.purpose ?? '';

    try {
        const match = await prisma.sendRecord.findFirst({
            where: {
                ownerId,
                status: 'active',
                ...(purpose ? { topic: purpose } : {}),
                ...(vendorEmail
                    ? {
                          OR: [
                              { vendorEmail: { equals: vendorEmail, mode: 'insensitive' } },
                              { vendorEmail: { contains: vendorEmail, mode: 'insensitive' } },
                          ],
                      }
                    : {}),
            },
            orderBy: { createdAt: 'desc' },
            select: { id: true },
        });

        if (match) {
            await prisma.sendRecord.update({
                where: { id: match.id },
                data: { status: options.status, expiredAt: new Date() },
            });
            return;
        }

        await prisma.sendRecord.updateMany({
            where: { ownerId, status: 'active', ...(purpose ? { topic: purpose } : {}) },
            data: { status: options.status, expiredAt: new Date() },
        });
    } catch (err) {
        logger.warn(
            '[send-record] stamp failed',
            err instanceof Error ? err.message : 'Unknown',
        );
    }
}
