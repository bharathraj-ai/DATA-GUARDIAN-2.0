import { prisma } from '@/lib/prisma';

/**
 * Compliance events go on the HMAC-chained AuditLog (not the removed OnlyOffice table).
 */

export type AuditAction = 'upload' | 'view' | 'edit' | 'download' | 'delete' | 'page_view';

export interface AuditLogEntry {
  documentId?: string;
  fileId?: string;
  linkId?: string;
  ownerId?: string | null;
  userId?: string | null;
  action: AuditAction;
  ipAddress?: string | null;
  userAgent?: string | null;
  metadata?: Record<string, unknown>;
}

export async function logDocumentEvent(entry: AuditLogEntry): Promise<void> {
  try {
    await prisma.auditLog.create({
      data: {
        action: entry.action.toUpperCase(),
        ownerId: entry.ownerId ?? undefined,
        linkId: entry.linkId ?? undefined,
        reason: entry.fileId || entry.documentId || undefined,
        metadata: JSON.stringify({
          ...(entry.metadata || {}),
          userId: entry.userId,
          ipAddress: entry.ipAddress,
          userAgent: entry.userAgent,
          fileId: entry.fileId,
        }),
      },
    });
  } catch (error) {
    console.error('[AUDIT] Failed to log document event:', error);
  }
}

export async function logDocumentEvents(entries: AuditLogEntry[]): Promise<void> {
  await Promise.all(entries.map((entry) => logDocumentEvent(entry)));
}

export function extractRequestInfo(request: Request): {
  ipAddress: string | null;
  userAgent: string | null;
} {
  const headers = request.headers;

  const ipAddress =
    headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    headers.get('x-real-ip') ||
    null;

  const userAgent = headers.get('user-agent') || null;

  return { ipAddress, userAgent };
}
