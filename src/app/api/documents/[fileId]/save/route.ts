import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { encryptBuffer, generateDek, encryptDek } from '@/lib/crypto';
import { authorizeApiRequest } from '@/lib/api-auth';
import { checkUploadRateLimit, extractClientIP } from '@/lib/rate-limit';
import { headers } from 'next/headers';

function dataUrlToBytes(dataUrl: string): Buffer {
  const base64 = dataUrl.split(',')[1] || dataUrl;
  return Buffer.from(base64, 'base64');
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/documents/[fileId]/save
 * Body: { token, dataUrl, changeDescription? }
 *
 * Re-encrypts the edited document and creates a FileVersion snapshot.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ fileId: string }> },
) {
  try {
    const { fileId } = await params;
    const body = await req.json() as {
      token: string;
      dataUrl: string;
      changeDescription?: string;
      changeType?: string;
    };

    const { token, dataUrl, changeDescription, changeType = 'collaborative_edit' } = body;
    if (!token || !dataUrl) return NextResponse.json({ error: 'Missing fields' }, { status: 400 });

    const MAX_DECODED_BYTES = 50 * 1024 * 1024;
    if (dataUrl.length > MAX_DECODED_BYTES * 2) {
      return NextResponse.json({ error: 'Payload too large' }, { status: 413 });
    }

    // Auth (Zero-Trust Session + API Security)
    const authResult = await authorizeApiRequest(fileId, token, { httpMethod: req.method, action: 'edit', includeContent: true });
    if (authResult.errorResponse) {
      return authResult.errorResponse;
    }
    const { requireHeldEditLock } = await import('@/lib/collaboration/edit-lock-http');
    const lockGate = await requireHeldEditLock(authResult, (body as { clientInstanceId?: string }).clientInstanceId);
    if ('errorResponse' in lockGate) return lockGate.errorResponse;
    const { file } = authResult;

    // ── Rate Limit check ─────────────────────────────────────────
    const requestHeaders = await headers();
    const clientIP = extractClientIP(requestHeaders);
    const rateLimit = await checkUploadRateLimit(clientIP);
    if (!rateLimit.allowed) {
      return NextResponse.json({ error: 'Rate limit exceeded for saves. Please try again later.' }, { status: 429 });
    }

    const rawBytes = dataUrlToBytes(dataUrl);
    if (rawBytes.length > MAX_DECODED_BYTES) {
      return NextResponse.json({ error: 'Decoded document exceeds size limit' }, { status: 413 });
    }
    const newDek = generateDek();
    const encrypted = encryptBuffer(rawBytes, newDek);
    const encryptedDekStr = encryptDek(newDek);

    let versionNumber = 0;
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        versionNumber = await prisma.$transaction(async (tx) => {
          const agg = await tx.fileVersion.aggregate({
            where: { fileId },
            _max: { versionNumber: true },
          });
          const next = (agg._max.versionNumber ?? 0) + 1;
          await tx.fileVersion.create({
            data: {
              fileId,
              versionNumber: next,
              encryptedContent: file.encryptedContent!,
              iv: file.iv!,
              authTag: file.authTag!,
              fileSize: file.fileSize,
              changeType,
              changeDescription: changeDescription ?? 'Collaborative edit',
            },
          });
          await tx.userFile.update({
            where: { id: fileId },
            data: {
              encryptedContent: encrypted.encryptedContent,
              iv: encrypted.iv,
              authTag: encrypted.authTag,
              encryptedDek: encryptedDekStr,
              fileSize: rawBytes.length,
            },
          });
          // SECURITY: Cap FileVersion history to 10 versions to prevent unbounded DB growth
          const MAX_VERSIONS = 10;
          const versionCount = await tx.fileVersion.count({ where: { fileId } });
          if (versionCount > MAX_VERSIONS) {
              const versionsToDelete = await tx.fileVersion.findMany({
                  where: { fileId },
                  orderBy: { versionNumber: 'asc' },
                  take: versionCount - MAX_VERSIONS,
                  select: { id: true }
              });
              await tx.fileVersion.deleteMany({
                  where: { id: { in: versionsToDelete.map(v => v.id) } }
              });
          }

          return next;
        });
        break;
      } catch (e: unknown) {
        const code = typeof e === 'object' && e !== null && 'code' in e ? (e as { code?: string }).code : '';
        if (code === 'P2002' && attempt < 4) continue;
        throw e;
      }
    }

    if (versionNumber === 0) {
      return NextResponse.json({ error: 'Could not persist document version' }, { status: 503 });
    }

    return NextResponse.json({ success: true, versionNumber });
  } catch (err) {
    console.error('[save] error:', err);
    return NextResponse.json({ error: 'Failed to save document' }, { status: 500 });
  }
}
