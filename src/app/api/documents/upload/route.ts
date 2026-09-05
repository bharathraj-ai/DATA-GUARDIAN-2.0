import { NextResponse } from 'next/server';

/**
 * Legacy OnlyOffice / plaintext-disk upload. Files are staged through
 * /api/create-link/stage and stored as GridFS ciphertext.
 */
export async function POST() {
  return NextResponse.json(
    {
      error: 'Direct disk upload was removed. Use create-link to share encrypted files.',
    },
    { status: 410 },
  );
}
