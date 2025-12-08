// /workspaces/Vext/app/api/setup-payout/route.ts

import { NextRequest, NextResponse } from 'next/server';

/**
 * Stub endpoint for setup-payout.
 *
 * Right now this just returns a 501 "Not implemented" so that:
 * - The file is a valid module for TypeScript/Next.js
 * - Any accidental calls to /api/setup-payout get a clear response
 *
 * Later, you can implement real payout setup logic here
 * (e.g. integrating with Paystack, MPesa, etc.).
 */

export async function POST(_req: NextRequest) {
  return NextResponse.json(
    {
      ok: false,
      error: 'setup-payout endpoint not implemented yet',
    },
    { status: 501 },
  );
}

// Optional: you can also expose a GET if you ever want to check status
export async function GET(_req: NextRequest) {
  return NextResponse.json(
    {
      ok: true,
      message: 'setup-payout stub endpoint is live.',
    },
    { status: 200 },
  );
}