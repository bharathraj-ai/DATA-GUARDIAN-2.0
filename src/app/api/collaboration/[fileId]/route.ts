import { NextRequest, NextResponse } from 'next/server';
import { authorizeApiRequest } from '@/lib/api-auth';
import { findUserFileForShareToken } from '@/lib/security/resource-ownership';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/collaboration/[fileId]?token=
 *
 * Health/ready check for collaboration. Does NOT expose document content.
 * IDOR-safe: fileId must belong to the share token, and session must authorize view.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ fileId: string }> },
) {
  const { fileId } = await params;
  const token = req.nextUrl.searchParams.get('token');

  if (!token) {
    return NextResponse.json({ error: 'Missing token' }, { status: 401 });
  }

  // Bind fileId → token before any further work
  const owned = await findUserFileForShareToken(fileId, token);
  if (!owned) {
    // Uniform response — do not reveal whether fileId or token was wrong
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const authResult = await authorizeApiRequest(fileId, token, {
    httpMethod: req.method,
    action: 'view',
  });
  if (authResult.errorResponse) {
    return authResult.errorResponse;
  }

  return NextResponse.json({
    status: 'ready',
    fileId: owned.id,
    message: 'Authorized for collaboration presence',
  });
}
