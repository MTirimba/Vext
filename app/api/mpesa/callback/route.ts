// /app/api/mpesa/b2c/callback/route.ts
import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  console.log('B2C Result callback:', JSON.stringify(body, null, 2));
  // In future: save to Firestore as withdrawal result
  return NextResponse.json({ received: true });
}