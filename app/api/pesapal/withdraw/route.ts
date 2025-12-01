// /app/api/pesapal/withdraw/route.ts
import { NextResponse } from "next/server";
import { adminDb } from "@/lib/firebaseAdmin";
import { v4 as uuidv4 } from "uuid";

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { uid, amount } = body;

    if (!uid || !amount || amount <= 0) {
      return NextResponse.json(
        { error: "Missing or invalid withdrawal data" },
        { status: 400 }
      );
    }

    // ✅ Find provider by UID
    const providerRef = adminDb.collection("users").doc(uid);
    const providerSnap = await providerRef.get();

    if (!providerSnap.exists) {
      return NextResponse.json(
        { error: "No provider found for withdrawal" },
        { status: 404 }
      );
    }

    const provider = providerSnap.data();
    const payoutPhone = provider?.payout_phone;
    const fullName = provider?.fullName || "Provider";

    if (!payoutPhone) {
      return NextResponse.json(
        { error: "Provider payout phone not set" },
        { status: 400 }
      );
    }

    // ✅ Get Pesapal Token
    const {
      PESAPAL_CONSUMER_KEY,
      PESAPAL_CONSUMER_SECRET,
      PESAPAL_BASE_URL,
    } = process.env;

    const tokenRes = await fetch(`${PESAPAL_BASE_URL}/Auth/RequestToken`, {
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
      console.error("❌ Pesapal token error:", tokenData);
      return NextResponse.json(
        { error: "Failed to authenticate with Pesapal" },
        { status: 500 }
      );
    }

    // ✅ Send payout via Pesapal
    const payoutId = uuidv4();
    const payoutPayload = {
      currency: "KES",
      amount: parseFloat(amount).toFixed(2),
      recipient_phone_number: payoutPhone,
      recipient_country_code: "KE",
      narrative: `Withdrawal for ${fullName}`,
      sender_reference: payoutId,
    };

    const payoutRes = await fetch(
      `${PESAPAL_BASE_URL}/Payouts/SubmitPayoutRequest`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify(payoutPayload),
      }
    );

    const payoutData = await payoutRes.json();
    console.log("💸 Pesapal Payout Response:", payoutData);

    if (!payoutRes.ok) {
      return NextResponse.json(
        { error: payoutData?.message || "Pesapal payout failed" },
        { status: 500 }
      );
    }

    // ✅ Record withdrawal in Firestore
    await providerRef.collection("withdrawals").doc(payoutId).set({
      id: payoutId,
      amount,
      method: "pesapal",
      phone: payoutPhone,
      status: "processing",
      timestamp: new Date().toISOString(),
      pesapal_ref: payoutData?.order_tracking_id || null,
    });

    return NextResponse.json({
      message: "Withdrawal initiated successfully via Pesapal",
      pesapalResponse: payoutData,
    });
  } catch (err: any) {
    console.error("🔥 Withdrawal error:", err);
    return NextResponse.json(
      { error: err.message || "Withdrawal failed" },
      { status: 500 }
    );
  }
}