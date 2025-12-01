// /app/api/mpesa/b2c/route.ts
import { NextRequest, NextResponse } from 'next/server';

const MPESA_ENV = process.env.MPESA_ENV || 'sandbox';

// Base URL switches by environment
const MPESA_BASE_URL =
  MPESA_ENV === 'production'
    ? 'https://api.safaricom.co.ke'
    : 'https://sandbox.safaricom.co.ke';

const CONSUMER_KEY = process.env.MPESA_CONSUMER_KEY!;
const CONSUMER_SECRET = process.env.MPESA_CONSUMER_SECRET!;

// Live & sandbox both use a B2C shortcode, initiator and security credential.
// You already have sandbox values; for production you’ll paste the live ones.
const B2C_SHORTCODE = process.env.MPESA_B2C_SHORTCODE!; // e.g. 3003129 (prod) or 600986 (sandbox)
const B2C_INITIATOR_NAME = process.env.MPESA_B2C_INITIATOR_NAME!; // e.g. "testapi" (sandbox) / your live initiator
const B2C_SECURITY_CREDENTIAL = process.env.MPESA_B2C_SECURITY_CREDENTIAL!;

const B2C_RESULT_URL = process.env.MPESA_B2C_RESULT_URL!;
const B2C_TIMEOUT_URL = process.env.MPESA_B2C_TIMEOUT_URL!;

// Use v3 in sandbox, v1 in production (per Safaricom email)
const B2C_ENDPOINT_PATH =
  MPESA_ENV === 'production'
    ? '/mpesa/b2c/v1/paymentrequest'
    : '/mpesa/b2c/v3/paymentrequest';

async function getAccessToken() {
  const auth = Buffer.from(`${CONSUMER_KEY}:${CONSUMER_SECRET}`).toString(
    'base64'
  );

  const res = await fetch(
    `${MPESA_BASE_URL}/oauth/v1/generate?grant_type=client_credentials`,
    {
      headers: {
        Authorization: `Basic ${auth}`,
      },
    }
  );

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Failed to get access token: ${text}`);
  }

  const data = (await res.json()) as { access_token: string };
  return data.access_token;
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const amount = Number(body.amount);
    const phoneNumber = String(body.phoneNumber || '').trim();
    const remarks =
      (body.remarks as string | undefined) || 'Provider withdrawal';

    if (!amount || amount <= 0) {
      return NextResponse.json(
        { error: 'Invalid amount provided.' },
        { status: 400 }
      );
    }

    if (!phoneNumber) {
      return NextResponse.json(
        { error: 'phoneNumber is required.' },
        { status: 400 }
      );
    }

    // react-phone-number-input already gives us an E.164 number like +2547...
    // Safaricom expects 2547XXXXXXXX
    const normalizedPhone = phoneNumber
      .replace(/\s+/g, '')
      .replace(/^\+/, '');

    const token = await getAccessToken();

    const OriginatorConversationID = `VEXT_${Date.now()}`;

    const payload = {
      OriginatorConversationID,
      InitiatorName: B2C_INITIATOR_NAME,
      SecurityCredential: B2C_SECURITY_CREDENTIAL,
      CommandID: 'BusinessPayment', // or 'SalaryPayment' / 'PromotionPayment'
      Amount: amount,
      PartyA: B2C_SHORTCODE, // your shortcode
      PartyB: normalizedPhone, // customer phone, e.g. 2547XXXXXXXX
      Remarks: remarks,
      QueueTimeOutURL: B2C_TIMEOUT_URL,
      ResultURL: B2C_RESULT_URL,
      Occasion: 'Withdrawal',
    };

    console.log('[M-Pesa B2C] Outgoing payload:', JSON.stringify(payload, null, 2));

    const res = await fetch(`${MPESA_BASE_URL}${B2C_ENDPOINT_PATH}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    const data = await res.json().catch(() => ({} as any));

    if (!res.ok) {
      console.error('[M-Pesa B2C] error response:', res.status, data);
      return NextResponse.json(
        {
          error:
            (data as any)?.errorMessage ||
            (data as any)?.errorCode ||
            'M-Pesa B2C request failed',
          mpesaResponse: data,
        },
        { status: 500 }
      );
    }

    console.log('[M-Pesa B2C] Success response:', JSON.stringify(data, null, 2));

    return NextResponse.json(
      {
        mpesaResponse: data,
      },
      { status: 200 }
    );
  } catch (err: any) {
    console.error('B2C API route error:', err);
    return NextResponse.json(
      { error: err?.message || 'Internal server error' },
      { status: 500 }
    );
  }
}