import { prisma } from '@/lib/prisma';
import { logger } from '@/lib/logger';

export type EditLockAuditAction =
    | 'EDIT_LOCK_ACQUIRED'
    | 'EDIT_LOCK_RELEASED'
    | 'PRIORITY_ACCESS_REQUESTED'
    | 'PRIORITY_ACCESS_ACCEPTED'
    | 'PRIORITY_TAKEOVER_STARTED'
    | 'PRIORITY_TAKEOVER_COMPLETED'
    | 'AUTO_SAVE_BEFORE_TAKEOVER'
    | 'DOCUMENT_VERSION_CREATED'
    | 'LOW_PRIORITY_SESSION_REVOKED'
    | 'EDIT_LOCK_HEARTBEAT'
    | 'EDIT_LOCK_DENIED'
    | 'EDIT_LOCK_UNAVAILABLE'
    | 'STALE_SESSION_WRITE_DENIED';

export interface EditLockAuditFields {
    actorUserId?: string | null;
    targetUserId?: string | null;
    documentId?: string;
    teamId?: string | null;
    previousPriority?: number | null;
    requesterPriority?: number | null;
    sessionId?: string | null;
    reason?: string | null;
    generation?: number | null;
    [key: string]: unknown;
}

export async function logEditLockAudit(
    action: EditLockAuditAction,
    linkId: string | null | undefined,
    fields: EditLockAuditFields,
): Promise<void> {
    try {
        const {
            actorUserId,
            targetUserId,
            documentId,
            teamId,
            previousPriority,
            requesterPriority,
            sessionId,
            reason,
            ...rest
        } = fields;

        await prisma.auditLog.create({
            data: {
                action,
                linkId: linkId || undefined,
                reason: reason || action,
                metadata: JSON.stringify({
                    actorUserId: actorUserId ?? null,
                    targetUserId: targetUserId ?? null,
                    documentId: documentId ?? null,
                    teamId: teamId ?? null,
                    previousPriority: previousPriority ?? null,
                    requesterPriority: requesterPriority ?? null,
                    sessionId: sessionId ?? null,
                    timestamp: new Date().toISOString(),
                    reason: reason || action,
                    ...rest,
                }),
            },
        });
    } catch (err) {
        logger.error(`Failed to write edit-lock audit ${action}`, err);
    }
}
