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
    relatedId: string; // linkId or documentId
}

export async function getUnifiedAuditLogs(): Promise<UnifiedAuditLog[]> {
    const session = await auth();
    const userId = session?.user?.id;

    if (!userId) {
        throw new Error('Unauthorized');
    }

    try {
        // Fetch SecureLink AuditLogs
        const secureLinkLogs = await prisma.auditLog.findMany({
            where: {
                SecureLink: {
                    ownerId: userId
                }
            },
            include: {
                SecureLink: true
            },
            orderBy: {
                timestamp: 'desc'
            },
            take: 500 // Limit for performance
        });

        // Fetch DocumentAuditLogs
        const documentLogs = await prisma.documentAuditLog.findMany({
            where: {
                document: {
                    ownerId: userId
                }
            },
            include: {
                document: true
            },
            orderBy: {
                createdAt: 'desc'
            },
            take: 500
        });

        // Map SecureLink AuditLogs
        const mappedSecureLinkLogs: UnifiedAuditLog[] = secureLinkLogs.map(log => {
            let severity: Severity = 'INFO';
            let description = log.reason || '';
            const metadataObj = log.metadata ? JSON.parse(log.metadata) : {};

            if (log.action === 'DENIED' || log.action === 'LOCKED' || log.action === 'REVOKED') {
                severity = 'CRITICAL';
            } else if (log.action === 'EXPIRED') {
                severity = 'WARNING';
            }

            // Attempt to derive a better description if reason is missing
            if (!description) {
                switch (log.action) {
                    case 'CREATED':
                        description = `Secure link created for purpose: ${log.SecureLink?.purpose || 'General'}`;
                        break;
                    case 'ACCESSED':
                        description = `Link was successfully verified and accessed.`;
                        break;
                    case 'CLEANUP':
                        description = `Expired data was automatically purged.`;
                        break;
                    case 'NOTIFIED':
                        description = `Security notification was sent to owner.`;
                        break;
                    default:
                        description = `System event: ${log.action}`;
                }
            }

            // If action is failed OTP context
            if (log.action === 'DENIED' && metadataObj.type === 'otp_reuse') {
                severity = 'WARNING';
            }

            return {
                id: log.id,
                type: 'SECURITY',
                action: log.action,
                severity,
                actor: metadataObj.attemptedEmail || metadataObj.notificationEmail || 'System/Anonymous',
                ipAddress: metadataObj.ip || null,
                userAgent: null,
                metadata: metadataObj,
                description,
                timestamp: log.timestamp,
                relatedId: log.linkId || 'unknown'
            };
        });

        // Map DocumentAuditLogs
        const mappedDocumentLogs: UnifiedAuditLog[] = documentLogs.map(log => {
            let severity: Severity = 'INFO';
            let description = '';
            const metadataObj = log.metadata ? JSON.parse(log.metadata) : {};

            if (log.action === 'delete') {
                severity = 'WARNING';
            }

            switch (log.action) {
                case 'upload':
                    description = `Document uploaded: ${log.document.fileName}`;
                    break;
                case 'view':
                    description = `Document viewed by participant.`;
                    break;
                case 'edit':
                    description = `Document was edited and new version saved.`;
                    break;
                case 'download':
                    description = `Document downloaded.`;
                    severity = 'WARNING'; // Downloads are usually restricted, so flag as warning
                    break;
                case 'delete':
                    description = `Document deleted from storage.`;
                    break;
                default:
                    description = `Document action: ${log.action}`;
            }

            return {
                id: log.id,
                type: 'DOCUMENT',
                action: log.action.toUpperCase(),
                severity,
                actor: log.userId || 'Unknown User',
                ipAddress: log.ipAddress || null,
                userAgent: log.userAgent || null,
                metadata: metadataObj,
                description,
                timestamp: log.createdAt,
                relatedId: log.documentId
            };
        });

        const allLogs = [...mappedSecureLinkLogs, ...mappedDocumentLogs];
        
        // Sort newest first
        allLogs.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());

        return allLogs;
    } catch (error) {
        console.error('Error fetching unified audit logs:', error);
        return [];
    }
}
