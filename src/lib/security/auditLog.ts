import { prisma } from '@/lib/prisma';

/**
 * Document Audit Logging System
 *
 * Every document event is recorded in an append-only log:
 *   upload | view | edit | download | delete
 *
 * Logs are stored in PostgreSQL (DocumentAuditLog table) and include
 * user identity, IP address, user agent, and optional metadata.
 *
 * These logs are NEVER deleted — they form a compliance audit trail.
 */

export type AuditAction = 'upload' | 'view' | 'edit' | 'download' | 'delete';

export interface AuditLogEntry {
  documentId: string;
  userId?: string | null;
  action: AuditAction;
  ipAddress?: string | null;
  userAgent?: string | null;
  metadata?: Record<string, unknown>;
}

/**
 * Log a document event to the audit trail.
 *
 * Non-blocking by design — audit logging should never cause
 * a request to fail. Errors are logged to console.
 */
export async function logDocumentEvent(entry: AuditLogEntry): Promise<void> {
  try {
    await prisma.documentAuditLog.create({
      data: {
        documentId: entry.documentId,
        userId: entry.userId,
        action: entry.action,
        ipAddress: entry.ipAddress,
        userAgent: entry.userAgent,
        metadata: entry.metadata ? JSON.stringify(entry.metadata) : null,
      },
    });
  } catch (error) {
    // Never let audit logging break the main flow
    console.error('[AUDIT] Failed to log document event:', error);
  }
}

/**
 * Batch log multiple events (e.g. when processing bulk operations).
 */
export async function logDocumentEvents(entries: AuditLogEntry[]): Promise<void> {
  try {
    await prisma.documentAuditLog.createMany({
      data: entries.map((entry) => ({
        documentId: entry.documentId,
        userId: entry.userId,
        action: entry.action,
        ipAddress: entry.ipAddress,
        userAgent: entry.userAgent,
        metadata: entry.metadata ? JSON.stringify(entry.metadata) : null,
      })),
    });
  } catch (error) {
    console.error('[AUDIT] Failed to batch log document events:', error);
  }
}

/**
 * Extract client IP and user agent from a Request object.
 * Handles common proxy headers (X-Forwarded-For, X-Real-IP).
 */
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
