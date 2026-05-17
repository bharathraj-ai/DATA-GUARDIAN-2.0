import { NextResponse } from 'next/server';
import { cleanupExpiredData } from '@/actions/cleanup';
import { authorizeCronRequest } from '@/lib/security/cron-auth';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const cron = authorizeCronRequest(request);
  if (!cron.ok) {
    return NextResponse.json(
      { error: cron.message },
      { status: cron.status },
    );
  }

  const result = await cleanupExpiredData();

  const headers = {
    'Cache-Control': 'no-cache, no-store, must-revalidate, max-age=0',
    Pragma: 'no-cache',
    Expires: '0',
  };

  if (result.success) {
    return NextResponse.json(
      {
        message: 'Cleanup completed — all expired data permanently deleted',
        deletedLinks: result.deletedLinks,
        deletedUserData: result.deletedUserData,
        deletedFiles: result.deletedFiles,
        deletedAuditLogs: result.deletedAuditLogs,
      },
      { headers },
    );
  }

  return NextResponse.json({ error: result.error }, { status: 500, headers });
}
