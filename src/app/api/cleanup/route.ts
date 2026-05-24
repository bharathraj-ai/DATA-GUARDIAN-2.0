import { NextResponse } from 'next/server';
import { executeCleanup } from '@/lib/cleanup-core';
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

  const result = await executeCleanup();

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
        deletedMongoFiles: result.deletedMongoFiles,
        deletedAuditLogs: result.deletedAuditLogs,
      },
      { headers },
    );
  }

  return NextResponse.json({ error: result.error }, { status: 500, headers });
}
