// /app/api/pesapal/register-ipn/route.ts
import { NextResponse } from "next/server";

export async function GET() {
  try {
    const {
      PESAPAL_CONSUMER_KEY,
      PESAPAL_CONSUMER_SECRET,
      PESAPAL_OAUTH_URL,
      PESAPAL_IPN_URL,
      APP_URL,
    } = process.env;

    if (!PESAPAL_CONSUMER_KEY || !PESAPAL_CONSUMER_SECRET) {
      return NextResponse.json({ error: "Missing Pesapal credentials" }, { status: 500 });
    }

    // STEP 1: Request Access Token
    const tokenRes = await fetch(PESAPAL_OAUTH_URL!, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        consumer_key: PESAPAL_CONSUMER_KEY,
        consumer_secret: PESAPAL_CONSUMER_SECRET,
      }),
    });
    const tokenData = await tokenRes.json();
    const accessToken = tokenData?.token;

    if (!accessToken) {
      return NextResponse.json({ error: "Failed to get token", details: tokenData }, { status: 500 });
    }

    // STEP 2: Register IPN
    const ipnRes = await fetch(PESAPAL_IPN_URL!, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({
        url: `${APP_URL}/api/pesapal/callback`,
        ipn_notification_type: "GET",
      }),
    });

    const ipnData = await ipnRes.json();
    return NextResponse.json(ipnData);
  } catch (err: any) {
    return NextResponse.json({ error: "Failed to register IPN", details: err.message }, { status: 500 });
  }
}