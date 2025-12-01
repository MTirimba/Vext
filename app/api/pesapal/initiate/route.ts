// /app/api/pesapal/initiate/route.ts
import { NextResponse } from "next/server";

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { amount, email, phone, description, reference } = body; // reference = bookingId

    console.log("🧾 Pesapal Payment Initiation Request:", body);

    const {
      PESAPAL_CONSUMER_KEY,
      PESAPAL_CONSUMER_SECRET,
      PESAPAL_BASE_URL,
      APP_URL,
      PESAPAL_NOTIFICATION_ID,
    } = process.env;

    if (!PESAPAL_CONSUMER_KEY || !PESAPAL_CONSUMER_SECRET || !PESAPAL_BASE_URL) {
      return NextResponse.json(
        { error: "Missing required PESAPAL environment variables." },
        { status: 500 }
      );
    }

    // 1) Request OAuth Token
    const authResponse = await fetch(`${PESAPAL_BASE_URL}/Auth/RequestToken`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        consumer_key: PESAPAL_CONSUMER_KEY,
        consumer_secret: PESAPAL_CONSUMER_SECRET,
      }),
    });

    const authData = await authResponse.json();
    if (!authData.token) {
      console.error("❌ Failed to get Pesapal token:", authData);
      return NextResponse.json(
        { error: "Authentication failure", details: authData },
        { status: 500 }
      );
    }

    const accessToken = authData.token;

    // ✅ KEY CHANGE: Use merchant_reference instead of id
    const orderPayload = {
      id: reference,                     // add this
      merchant_reference: reference,     // and this
      amount: parseFloat(amount).toFixed(2),
      currency: "KES",
      description,
      callback_url: `${APP_URL}/api/pesapal/callback`,
      cancellation_url: `${APP_URL}/cancel`,
      notification_id: PESAPAL_NOTIFICATION_ID,
      billing_address: {
        email_address: email,
        phone_number: phone,
        country_code: "KE",
        first_name: email?.split("@")[0] || "",
        last_name: "",
        line_1: "Nairobi",
        city: "Nairobi",
      },
    };

    console.log("📦 Pesapal Order Payload:", orderPayload);

    // 3) Submit Order
    const orderResponse = await fetch(
      `${PESAPAL_BASE_URL}/Transactions/SubmitOrderRequest`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify(orderPayload),
      }
    );

    const orderResult = await orderResponse.json();
    console.log("✅ Pesapal Order Response:", orderResult);

    if (!orderResult.redirect_url) {
      return NextResponse.json(
        { error: "Order creation failed", details: orderResult },
        { status: 500 }
      );
    }

    return NextResponse.json({ payment_url: orderResult.redirect_url });

  } catch (err: any) {
    console.error("🔥 Unexpected Payment Initiation Error:", err);
    return NextResponse.json(
      { error: "Server error", details: err.message },
      { status: 500 }
    );
  }
}