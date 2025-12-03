// /workspaces/Vext/app/api/mpesa/init/route.ts
import { NextRequest, NextResponse } from "next/server";
import { adminDb } from "@/lib/firebaseAdmin";

// 🧹 Utility: sanitize phone number into Safaricom’s 2547XXXXXXXX format
function sanitizePhone(phone: string): string {
  const cleaned = phone.replace(/\D/g, "");
  if (cleaned.startsWith("0")) return "254" + cleaned.slice(1);
  if (cleaned.startsWith("7")) return "254" + cleaned;
  if (cleaned.startsWith("254")) return cleaned;
  throw new Error("Invalid Safaricom phone number format");
}

// ⚙️ Utility: load environment depending on MPESA_ENV
function env(key: string) {
  const mode =
    process.env.MPESA_ENV?.toLowerCase() === "live" ? "LIVE" : "SANDBOX";
  return (
    process.env[`MPESA_${mode}_${key}`] ||
    process.env[`MPESA_${key}`] ||
    ""
  );
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    console.log("📲 [M-PESA INIT] STK Push request:", body);

    const { phoneNumber, amount, bookingId } = body as {
      phoneNumber?: string;
      amount?: number | string;
      bookingId?: string;
      accountReference?: string;
      description?: string;
    };

    const accountReference = body.accountReference as string | undefined;
    const description = body.description as string | undefined;

    if (!phoneNumber || !amount || !bookingId) {
      return NextResponse.json(
        { error: "Missing phoneNumber, amount or bookingId" },
        { status: 400 },
      );
    }

    const parsedAmount = Number(amount);
    if (isNaN(parsedAmount) || parsedAmount <= 0) {
      return NextResponse.json(
        { error: "Invalid amount" },
        { status: 400 },
      );
    }

    const sanitizedPhone = sanitizePhone(phoneNumber);

    // 🔐 Load credentials dynamically
    const consumerKey = env("CONSUMER_KEY");
    const consumerSecret = env("CONSUMER_SECRET");
    const shortcode = "3576615"; // ✅ Live business shortcode from Safaricom
    const tillNumber = "5695090"; // ✅ Till number for STK push
    const passkey = env("PASSKEY") || env("EXPRESS_PASSKEY");
    const callbackUrl =
      env("CALLBACK_URL") ||
      "https://reimagined-adventure-4jr44jgqpxj7f57jq-3000.app.github.dev/api/mpesa/callback";
    const baseUrl =
      process.env.MPESA_ENV === "live"
        ? "https://api.safaricom.co.ke"
        : "https://sandbox.safaricom.co.ke";

    console.log(`🌍 Environment: ${process.env.MPESA_ENV}`);
    console.log("🏦 Shortcode:", shortcode);
    console.log("💳 Till Number (PartyB):", tillNumber);
    console.log("🔗 Callback URL:", callbackUrl);

    // 1️⃣ Generate OAuth Token
    const auth = Buffer.from(`${consumerKey}:${consumerSecret}`).toString(
      "base64",
    );
    const tokenRes = await fetch(
      `${baseUrl}/oauth/v1/generate?grant_type=client_credentials`,
      { headers: { Authorization: `Basic ${auth}` } },
    );
    const tokenData = await tokenRes.json();
    console.log("🔑 OAuth Token response:", tokenData);

    const accessToken = tokenData.access_token;
    if (!accessToken) {
      return NextResponse.json(
        { error: "Failed to obtain access token" },
        { status: 500 },
      );
    }

    // 2️⃣ Build STK payload
    const timestamp = new Date()
      .toISOString()
      .replace(/[-T:\.Z]/g, "")
      .slice(0, 14);
    const password = Buffer.from(shortcode + passkey + timestamp).toString(
      "base64",
    );

    const stkPayload = {
      BusinessShortCode: shortcode, // ✅ 3576615
      Password: password,
      Timestamp: timestamp,
      TransactionType: "CustomerBuyGoodsOnline", // ✅ For Till Number
      Amount: parsedAmount,
      PartyA: sanitizedPhone, // Customer number
      PartyB: tillNumber, // ✅ Till number
      PhoneNumber: sanitizedPhone, // ✅ Customer’s phone
      CallBackURL: callbackUrl,
      AccountReference: accountReference || bookingId,
      TransactionDesc: description || `Booking ${bookingId}`,
    };

    console.log("📦 STK Payload:", stkPayload);

    // 3️⃣ Trigger STK Push
    const stkRes = await fetch(`${baseUrl}/mpesa/stkpush/v1/processrequest`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(stkPayload),
    });

    const stkData = await stkRes.json();
    console.log("📡 STK Push response:", stkData);

    // 4️⃣ Store CheckoutRequestID → booking for the callback to find
    try {
      if (stkData.CheckoutRequestID && bookingId) {
        await adminDb.collection("bookings").doc(bookingId).set(
          {
            mpesaCheckoutRequestId: stkData.CheckoutRequestID,
            mpesaMerchantRequestId: stkData.MerchantRequestID || null,
            mpesaRequestedAt: Date.now(),
          },
          { merge: true },
        );
        console.log(
          "🧾 [M-PESA INIT] Stored mpesaCheckoutRequestId on booking",
          bookingId,
        );
      } else {
        console.warn(
          "⚠️ [M-PESA INIT] No CheckoutRequestID or bookingId to store on booking",
        );
      }
    } catch (e) {
      console.error(
        "❌ [M-PESA INIT] Failed to store mpesa IDs on booking:",
        e,
      );
    }

    return NextResponse.json(stkData, { status: 200 });
  } catch (error: any) {
    console.error("❌ [M-PESA INIT ERROR]:", error.message || error);
    return NextResponse.json(
      { error: error.message || "Internal server error" },
      { status: 500 },
    );
  }
}