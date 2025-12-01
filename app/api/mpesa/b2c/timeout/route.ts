// /app/api/mpesa/b2c/timeout/route.ts
import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  console.log('B2C Timeout callback:', JSON.stringify(body, null, 2));
  return NextResponse.json({ received: true });
}