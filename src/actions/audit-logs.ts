'use server';

import { prisma } from '@/lib/prisma';
import { auth } from '@/lib/auth';

export type Severity = 'INFO' | 'WARNING' | 'CRITICAL';

export interface UnifiedAuditLog {
    id: string;
    type: 'SECURITY' | 'DOCUMENT';
    action: string;
    severity: Severity;
    actor: string;
    ipAddress: string | null;
    userAgent: string | null;
    metadata: Record<string, any>;
    description: string;
    timestamp: Date;
    relatedId: string;
}

export async function getUnifiedAuditLogs(): Promise<UnifiedAuditLog[]> {
    const session = await auth();
    const userId = session?.user?.id;

    if (!userId) {
        throw new Error('Unauthorized');
    }

    try {
        const secureLinkLogs = await prisma.auditLog.findMany({
            where: { ownerId: userId },
            select: {
                id: true,
                action: true,
                reason: true,
                metadata: true,
                timestamp: true,
                linkId: true,
                SecureLink: {
                    select: {
                        purpose: true,
                    },
                },
            },
            orderBy: {
                timestamp: 'desc'
            },
            take: 200,
        });

        return secureLinkLogs.map(log => {
            let severity: Severity = 'INFO';
            let description = log.reason || '';
            const metadataObj = log.metadata ? JSON.parse(log.metadata) : {};

            if (log.action === 'DENIED' || log.action === 'LOCKED' || log.action === 'REVOKED'
                || log.action === 'SUSPICIOUS_ACTIVITY_REVOKE' || log.action === 'REVOKE_ACCESS_SUCCESS') {
                severity = 'CRITICAL';
            } else if (log.action === 'EXPIRED' || log.action === 'PAGE_VIEW' || log.action === 'VIEW') {
                severity = log.action === 'EXPIRED' ? 'WARNING' : 'INFO';
            }

            if (!description) {
                switch (log.action) {
                    case 'CREATED':
                        description = `Secure link created for purpose: ${log.SecureLink?.purpose || 'General'}`;
                        break;
                    case 'ACCESSED':
                        description = `Link was successfully verified and accessed.`;
                        break;
                    case 'PAGE_VIEW':
                        description = `File previewed${metadataObj.fileId ? ` (${metadataObj.fileId})` : ''}.`;
                        break;
                    default:
                        description = `System event: ${log.action}`;
                }
            }

            if (log.action === 'DENIED' && metadataObj.type === 'otp_reuse') {
                severity = 'WARNING';
            }

            return {
                id: log.id,
                type: log.action === 'PAGE_VIEW' ? 'DOCUMENT' as const : 'SECURITY' as const,
                action: log.action,
                severity,
                actor: metadataObj.attemptedEmail || metadataObj.notificationEmail || metadataObj.viewerEmail || 'System/Anonymous',
                ipAddress: metadataObj.ip || metadataObj.ipAddress || null,
                userAgent: metadataObj.userAgent || null,
                metadata: metadataObj,
                description,
                timestamp: log.timestamp,
                relatedId: log.linkId || 'unknown'
            };
        });
    } catch (error) {
        console.error('Error fetching unified audit logs:', error);
        return [];
    }
}
