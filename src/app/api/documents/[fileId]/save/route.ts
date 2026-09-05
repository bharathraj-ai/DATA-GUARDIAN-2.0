import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { encryptBuffer, generateDek } from '@/lib/crypto';
import { authorizeApiRequest } from '@/lib/api-auth';
import { checkUploadRateLimit, extractClientIP } from '@/lib/rate-limit';
import { headers } from 'next/headers';
import {
  buildVersionSnapshot,
  createFileVersionRow,
  persistLiveCiphertext,
  trimOldFileVersions,
} from '@/lib/file-version-store';

function dataUrlToBytes(dataUrl: string): Buffer {
  const base64 = dataUrl.split(',')[1] || dataUrl;
  return Buffer.from(base64, 'base64');
}

async function readSavePayload(req: NextRequest): Promise<{
  token: string;
  rawBytes: Buffer;
  changeDescription?: string;
  changeType: string;
  clientInstanceId?: string;
} | { error: string; status: number }> {
  const contentType = req.headers.get('content-type') || '';
  const MAX_DECODED_BYTES = 50 * 1024 * 1024;

  if (contentType.includes('multipart/form-data')) {
    const form = await req.formData();
    const token = String(form.get('token') || '');
    const file = form.get('file');
    if (!token || !file || typeof file !== 'object' || !('arrayBuffer' in file)) {
      return { error: 'Missing fields', status: 400 };
    }
    const uploaded = file as File;
    if (uploaded.size > MAX_DECODED_BYTES) {
      return { error: 'Payload too large', status: 413 };
    }
    return {
      token,
      rawBytes: Buffer.from(await uploaded.arrayBuffer()),
      changeDescription: form.get('changeDescription')?.toString(),
      changeType: form.get('changeType')?.toString() || 'collaborative_edit',
      clientInstanceId: form.get('clientInstanceId')?.toString() || form.get('editClientInstanceId')?.toString(),
    };
  }

  if (contentType.includes('application/octet-stream')) {
    const token =
      req.nextUrl.searchParams.get('token') ||
      req.headers.get('x-share-token') ||
      '';
    if (!token) return { error: 'Missing fields', status: 400 };
    const buf = Buffer.from(await req.arrayBuffer());
    if (buf.length > MAX_DECODED_BYTES) {
      return { error: 'Payload too large', status: 413 };
    }
    return {
      token,
      rawBytes: buf,
      changeDescription: req.headers.get('x-change-description') || undefined,
      changeType: req.headers.get('x-change-type') || 'collaborative_edit',
      clientInstanceId: req.headers.get('x-client-instance-id') || undefined,
    };
  }

  const body = await req.json() as {
    token: string;
    dataUrl?: string;
    changeDescription?: string;
    changeType?: string;
    clientInstanceId?: string;
  };
  const { token, dataUrl, changeDescription, changeType = 'collaborative_edit' } = body;
  if (!token || !dataUrl) return { error: 'Missing fields', status: 400 };
  if (dataUrl.length > MAX_DECODED_BYTES * 2) {
    return { error: 'Payload too large', status: 413 };
  }
  const rawBytes = dataUrlToBytes(dataUrl);
  if (rawBytes.length > MAX_DECODED_BYTES) {
    return { error: 'Decoded document exceeds size limit', status: 413 };
  }
  return {
    token,
    rawBytes,
    changeDescription,
    changeType,
    clientInstanceId: body.clientInstanceId,
  };
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/documents/[fileId]/save
 * Body: multipart file, application/octet-stream, or legacy JSON { token, dataUrl }.
 *
 * Re-encrypts the edited document and creates a FileVersion snapshot in object storage.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ fileId: string }> },
) {
  try {
    const { fileId } = await params;
    const payload = await readSavePayload(req);
    if ('error' in payload) {
      return NextResponse.json({ error: payload.error }, { status: payload.status });
    }

    const { token, rawBytes, changeDescription, changeType, clientInstanceId } = payload;

    const authResult = await authorizeApiRequest(fileId, token, { httpMethod: req.method, action: 'edit', includeContent: true });
    if (authResult.errorResponse) {
      return authResult.errorResponse;
    }
    const { requireHeldEditLock } = await import('@/lib/collaboration/edit-lock-http');
    const lockGate = await requireHeldEditLock(authResult, clientInstanceId);
    if ('errorResponse' in lockGate) return lockGate.errorResponse;
    const { file } = authResult;

    const requestHeaders = await headers();
    const clientIP = extractClientIP(requestHeaders);
    const rateLimit = await checkUploadRateLimit(clientIP);
    if (!rateLimit.allowed) {
      return NextResponse.json({ error: 'Rate limit exceeded for saves. Please try again later.' }, { status: 429 });
    }

    const snapshot = await buildVersionSnapshot(file as never, { moveLiveObject: true });
    const newDek = generateDek();
    const encrypted = encryptBuffer(rawBytes, newDek);
    const { wrapDekForLink } = await import('@/lib/security/kms');
    const encryptedDekStr = await wrapDekForLink(newDek, authResult.secureLink.id);

    let versionNumber = 0;
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        const agg = await prisma.fileVersion.aggregate({
          where: { fileId },
          _max: { versionNumber: true },
        });
        const next = (agg._max.versionNumber ?? 0) + 1;
        if (snapshot) {
          await createFileVersionRow({
            fileId,
            versionNumber: next,
            snapshot,
            changeType,
            changeDescription: changeDescription ?? 'Collaborative edit',
          });
        }
        versionNumber = next;
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

    const ext = (file.fileName || 'document.bin').split('.').pop() || 'bin';
    await persistLiveCiphertext({
      fileId,
      fileName: file.fileName || 'document',
      mimeType: file.fileType || 'application/octet-stream',
      fileExtension: ext,
      ciphertext: encrypted.encryptedContent,
      iv: encrypted.iv,
      authTag: encrypted.authTag,
      encryptedDek: encryptedDekStr,
      plaintextSize: rawBytes.length,
      existingMongoFileId: (file as { mongoFileId?: string | null }).mongoFileId,
    });

    await trimOldFileVersions(fileId);

    return NextResponse.json({ success: true, versionNumber });
  } catch (err) {
    console.error('[save] error:', err);
    return NextResponse.json({ error: 'Failed to save document' }, { status: 500 });
  }
}
