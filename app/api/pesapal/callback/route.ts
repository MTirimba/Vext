// /app/api/pesapal/callback/route.ts
import { NextResponse } from "next/server";
import { adminDb } from "@/lib/firebaseAdmin";
import { confirmBookingCore } from "@/lib/confirmBookingCore";

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const orderTrackingId = url.searchParams.get("OrderTrackingId");
    const merchantReference = url.searchParams.get("OrderMerchantReference");

    if (!orderTrackingId) {
      return NextResponse.json({ error: "Missing OrderTrackingId" }, { status: 400 });
    }

    const {
      PESAPAL_CONSUMER_KEY,
      PESAPAL_CONSUMER_SECRET,
      PESAPAL_BASE_URL,
      PESAPAL_OAUTH_URL,
      PESAPAL_TRANSACTION_STATUS_URL,
    } = process.env;

    const authUrl = PESAPAL_OAUTH_URL || `${PESAPAL_BASE_URL}/Auth/RequestToken`;

    // Step 1: Get OAuth Token
    const tokenRes = await fetch(authUrl, {
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
      console.error("❌ Failed to get Pesapal token:", tokenData);
      return NextResponse.json(
        { error: "Authentication failed", details: tokenData },
        { status: 500 }
      );
    }

    // Step 2: Verify transaction
    const verifyUrl =
      PESAPAL_TRANSACTION_STATUS_URL ||
      `${PESAPAL_BASE_URL}/Transactions/GetTransactionStatus`;

    const verifyRes = await fetch(`${verifyUrl}?orderTrackingId=${orderTrackingId}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    const verifyData = await verifyRes.json();
    console.log("🔎 Pesapal Transaction Verify:", verifyData);

    const bookingId = merchantReference || verifyData?.merchant_reference;
    const status = verifyData?.payment_status_description || "Unknown";
    const amount = verifyData?.amount || 0;

    if (bookingId) {
      await adminDb.collection("bookings").doc(bookingId).update({ payment_status: status });

      // ✅ Automatically confirm booking if payment completed.
      // We've already verified this server-to-server with Pesapal above
      // (verifyData came from Pesapal's own GetTransactionStatus API), so
      // it's safe to confirm directly here without an end-user auth token —
      // going through the public /api/confirm-booking HTTP route isn't
      // appropriate here since that route requires a signed-in client.
      if (status.toLowerCase() === "completed") {
        try {
          const result = await confirmBookingCore({
            bookingId,
            paymentRef: orderTrackingId,
            method: "pesapal",
          });
          console.log("✅ Booking confirmation:", result.body);
        } catch (confirmErr) {
          console.error("⚠️ Auto-confirm booking failed:", confirmErr);
        }
      }
    } else {
      console.warn("⚠️ No bookingId found in callback response");
    }

    // ✅ Redirect user to payment success page
    const redirectUrl = `${process.env.NEXT_PUBLIC_BASE_URL}/payment-success?bookingId=${bookingId}&status=${status}&amount=${amount}`;
    return NextResponse.redirect(redirectUrl);
  } catch (err: any) {
    console.error("🔥 Pesapal callback error:", err);
    return NextResponse.json(
      { error: err.message || "Callback failed" },
      { status: 500 }
    );
  }
}