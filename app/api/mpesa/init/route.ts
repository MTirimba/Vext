// /workspaces/Vext/app/api/mpesa/init/route.ts
import { NextRequest, NextResponse } from "next/server";

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
  const mode = process.env.MPESA_ENV?.toLowerCase() === "live" ? "LIVE" : "SANDBOX";
  return process.env[`MPESA_${mode}_${key}`] || process.env[`MPESA_${key}`] || "";
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    console.log("📲 [M-PESA INIT] STK Push request:", body);

    const { phoneNumber, amount, accountReference, description } = body;
    if (!phoneNumber || !amount)
      return NextResponse.json({ error: "Missing phoneNumber or amount" }, { status: 400 });

    const parsedAmount = Number(amount);
    if (isNaN(parsedAmount) || parsedAmount <= 0)
      return NextResponse.json({ error: "Invalid amount" }, { status: 400 });

    const sanitizedPhone = sanitizePhone(phoneNumber);

    // 🔐 Load credentials dynamically
    const consumerKey = env("CONSUMER_KEY");
    const consumerSecret = env("CONSUMER_SECRET");
    const shortcode = "3576615"; // ✅ Live business shortcode from Safaricom
    const tillNumber = "5695090"; // ✅ Till number for STK push
    const passkey = env("PASSKEY") || env("EXPRESS_PASSKEY");
    const callbackUrl =
      env("CALLBACK_URL") ||
      "https://reimagined-yodel-979j646xwrjvcx74r-3000.app.github.dev/api/mpesa/callback";
    const baseUrl =
      process.env.MPESA_ENV === "live"
        ? "https://api.safaricom.co.ke"
        : "https://sandbox.safaricom.co.ke";

    console.log(`🌍 Environment: ${process.env.MPESA_ENV}`);
    console.log("🏦 Shortcode:", shortcode);
    console.log("💳 Till Number (PartyB):", tillNumber);
    console.log("🔗 Callback URL:", callbackUrl);

    // 1️⃣ Generate OAuth Token
    const auth = Buffer.from(`${consumerKey}:${consumerSecret}`).toString("base64");
    const tokenRes = await fetch(
      `${baseUrl}/oauth/v1/generate?grant_type=client_credentials`,
      { headers: { Authorization: `Basic ${auth}` } }
    );
    const tokenData = await tokenRes.json();
    console.log("🔑 OAuth Token response:", tokenData);

    const accessToken = tokenData.access_token;
    if (!accessToken)
      return NextResponse.json({ error: "Failed to obtain access token" }, { status: 500 });

    // 2️⃣ Build STK payload (Safaricom live parameters)
    const timestamp = new Date().toISOString().replace(/[-T:\.Z]/g, "").slice(0, 14);
    const password = Buffer.from(shortcode + passkey + timestamp).toString("base64");

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
      AccountReference: accountReference || "VextApp",
      TransactionDesc: description || "Payment",
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

    return NextResponse.json(stkData, { status: 200 });
  } catch (error: any) {
    console.error("❌ [M-PESA INIT ERROR]:", error.message || error);
    return NextResponse.json(
      { error: error.message || "Internal server error" },
      { status: 500 }
    );
  }
}