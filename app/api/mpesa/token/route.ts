// /workspaces/Vext/app/api/mpesa/token/route.ts

import { NextRequest, NextResponse } from 'next/server';

/**
 * Simple stub endpoint so this file is a valid module and passes type checking.
 *
 * Your live M-Pesa OAuth/token logic is handled inside the other MPesa endpoints
 * (e.g. /api/mpesa/init or /api/mpesa/b2c), so this route is currently just
 * informational. If you ever want a dedicated "token" endpoint, you can
 * implement the real logic here.
 */

export async function GET(_req: NextRequest) {
  return NextResponse.json(
    {
      ok: true,
      message:
        'MPesa token endpoint stub. OAuth is handled in other MPesa routes.',
    },
    { status: 200 },
  );
}