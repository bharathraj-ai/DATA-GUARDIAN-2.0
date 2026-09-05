import { NextResponse } from 'next/server';

/** Legacy OnlyOffice plaintext file stream — removed in Phase 4. */
export async function GET() {
  return NextResponse.json(
    { error: 'This file endpoint was removed. Use the share-link preview or download routes.' },
    { status: 410 },
  );
}
