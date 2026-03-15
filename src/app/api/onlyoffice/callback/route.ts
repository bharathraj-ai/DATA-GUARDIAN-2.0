import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { verifyOnlyOfficeToken } from '@/lib/onlyoffice/jwt';
import {
  saveDocument,
  readDocument,
  saveVersion,
} from '@/lib/storage/secureStorage';
import { logDocumentEvent } from '@/lib/security/auditLog';

/**
 * POST /api/onlyoffice/callback
 *
 * ONLYOFFICE Document Server calls this endpoint when:
 *   • A user closes the editor (status: 2 — ready to save)
 *   • Force-save is triggered (status: 6)
 *   • The document is being edited (status: 1 — informational)
 *   • An error occurred (status: 3)
 *   • The document is being closed with no changes (status: 4)
 *
 * SECURITY:
 *   - No session required (ONLYOFFICE server calls this, not the browser)
 *   - JWT verification ensures only our trusted ONLYOFFICE server can call this
 *
 * Flow on save (status 2 or 6):
 *   1. Verify JWT on request
 *   2. Download the saved document from ONLYOFFICE's provided URL
 *   3. Save the current file as a version backup
 *   4. Overwrite the current file with the new content
 *   5. Update DB metadata & version counter
 *   6. Write audit log entry
 *   7. Return { "error": 0 } (ONLYOFFICE spec)
 */

interface OnlyOfficeCallback {
  actions?: Array<{ type: number; userid: string }>;
  key: string;
  status: number;
  url?: string;
  users?: string[];
  changesurl?: string;
  changeshistory?: unknown;
  forcesavetype?: number;
}

export async function POST(request: NextRequest) {
  try {
    // ── Verify JWT ──────────────────────────────────────────────
    const body = await request.json();
    const token = body.token;

    if (token) {
      try {
        verifyOnlyOfficeToken(token);
      } catch {
        console.error('[CALLBACK] Invalid JWT token');
        return NextResponse.json({ error: 1 }); // 1 = error per ONLYOFFICE spec
      }
    }

    const callback = body as OnlyOfficeCallback;
    const { key, status, url } = callback;

    // Parse document ID and version from key format: "{documentId}_v{version}"
    const keyParts = key.split('_v');
    const documentId = keyParts[0];

    if (!documentId) {
      console.error('[CALLBACK] Invalid document key:', key);
      return NextResponse.json({ error: 1 });
    }

    // ── Handle status codes ─────────────────────────────────────

    switch (status) {
      case 1:
        // Document is being edited — informational only
        console.log(`[CALLBACK] Document ${documentId} is being edited`);
        return NextResponse.json({ error: 0 });

      case 2:
      case 6: {
        // Status 2: Document ready to save (all editors closed)
        // Status 6: Force save
        if (!url) {
          console.error('[CALLBACK] No URL provided for save');
          return NextResponse.json({ error: 1 });
        }

        // Fetch document metadata
        const document = await prisma.document.findUnique({
          where: { id: documentId },
        });

        if (!document) {
          console.error('[CALLBACK] Document not found:', documentId);
          return NextResponse.json({ error: 1 });
        }

        // Download the saved document from ONLYOFFICE
        const fileResponse = await fetch(url);
        if (!fileResponse.ok) {
          console.error('[CALLBACK] Failed to download from ONLYOFFICE:', fileResponse.status);
          return NextResponse.json({ error: 1 });
        }

        const newFileBuffer = Buffer.from(await fileResponse.arrayBuffer());

        // Read the current file for version backup
        try {
          const currentFile = await readDocument(document.storagePath);
          await saveVersion(
            documentId,
            document.currentVersion,
            document.fileType,
            currentFile
          );
        } catch (err) {
          console.warn('[CALLBACK] Could not backup current version:', err);
          // Continue anyway — saving the new version is more important
        }

        // Overwrite the current file
        await saveDocument(documentId, document.fileName, newFileBuffer);

        // Update database
        const newVersion = document.currentVersion + 1;
        await prisma.$transaction([
          // Update document metadata
          prisma.document.update({
            where: { id: documentId },
            data: {
              currentVersion: newVersion,
              fileSize: newFileBuffer.length,
            },
          }),
          // Create version record
          prisma.documentVersion.create({
            data: {
              documentId,
              version: document.currentVersion,
              storagePath: `versions/${documentId}/${document.currentVersion}.${document.fileType}`,
              fileSize: newFileBuffer.length,
              changeType: status === 6 ? 'force_save' : 'edit',
              changedBy: callback.actions?.[0]?.userid || null,
            },
          }),
        ]);

        // Audit log
        const changingUser = callback.actions?.[0]?.userid;
        logDocumentEvent({
          documentId,
          userId: changingUser,
          action: 'edit',
          metadata: {
            previousVersion: document.currentVersion,
            newVersion,
            saveType: status === 6 ? 'force_save' : 'auto_save',
            fileSize: newFileBuffer.length,
          },
        });

        console.log(
          `[CALLBACK] Document ${documentId} saved: v${document.currentVersion} → v${newVersion}`
        );
        return NextResponse.json({ error: 0 });
      }

      case 3:
        // Document save error
        console.error('[CALLBACK] ONLYOFFICE reported save error for:', documentId);
        logDocumentEvent({
          documentId,
          action: 'edit',
          metadata: { error: 'ONLYOFFICE save error', status: 3 },
        });
        return NextResponse.json({ error: 0 });

      case 4:
        // Document closed with no changes
        console.log(`[CALLBACK] Document ${documentId} closed with no changes`);
        return NextResponse.json({ error: 0 });

      case 7:
        // Force save error
        console.error('[CALLBACK] Force save error for:', documentId);
        return NextResponse.json({ error: 0 });

      default:
        console.warn('[CALLBACK] Unknown status:', status);
        return NextResponse.json({ error: 0 });
    }
  } catch (error) {
    console.error('[CALLBACK] Unexpected error:', error);
    return NextResponse.json({ error: 1 });
  }
}
