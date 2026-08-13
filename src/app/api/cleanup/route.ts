import { NextResponse } from 'next/server';
import { executeCleanup } from '@/lib/cleanup-core';
import { authorizeCronRequest } from '@/lib/security/cron-auth';

export const dynamic = 'force-dynamic';

/**
 * Scheduled cleanup — Vercel Cron uses GET; external schedulers may use POST.
 * Both require Authorization: Bearer CRON_SECRET.
 */
async function runCleanup(request: Request) {
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

  return NextResponse.json({ error: 'Cleanup failed' }, { status: 500, headers });
}

export async function GET(request: Request) {
  return runCleanup(request);
}

export async function POST(request: Request) {
  return runCleanup(request);
}
