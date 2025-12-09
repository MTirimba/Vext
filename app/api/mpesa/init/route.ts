// /app/api/mpesa/init/route.ts
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

// Helpful wrapper to log but not expose secret values in responses
function redact(value: string | undefined) {
  if (!value) return "(missing)";
  if (value.length <= 4) return "****";
  return value.slice(0, 2) + "****" + value.slice(-2);
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    console.log("📲 [M-PESA INIT] STK Push request body:", {
      ...body,
      phoneNumber: body?.phoneNumber ? "***redacted***" : undefined,
    });

    const {
      phoneNumber,
      amount,
      bookingId,
      accountReference,
      description,
    } = body as {
      phoneNumber?: string;
      amount?: number | string;
      bookingId?: string;
      accountReference?: string;
      description?: string;
    };

    if (!phoneNumber || !amount || !bookingId) {
      console.warn("[M-PESA INIT] Missing phoneNumber, amount or bookingId");
      return NextResponse.json(
        { error: "Missing phoneNumber, amount or bookingId" },
        { status: 400 },
      );
    }

    const parsedAmount = Number(amount);
    if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) {
      console.warn("[M-PESA INIT] Invalid amount:", amount);
      return NextResponse.json(
        { error: "Invalid amount" },
        { status: 400 },
      );
    }

    const sanitizedPhone = sanitizePhone(phoneNumber);

    // 🔐 Load credentials dynamically
    const consumerKey = env("CONSUMER_KEY");
    const consumerSecret = env("CONSUMER_SECRET");
    const passkey = env("PASSKEY") || env("EXPRESS_PASSKEY");

    // Allow overriding shortcode / till from env, but keep your current live values as defaults
    const shortcode =
      process.env.MPESA_SHORTCODE?.trim() || "3576615"; // Business shortcode
    const tillNumber =
      process.env.MPESA_TILL?.trim() || "5695090"; // Till number (PartyB)

    const callbackUrl =
      env("CALLBACK_URL") ||
      process.env.MPESA_CALLBACK_URL ||
      "https://vextup.com/api/mpesa/callback";

    const baseUrl =
      process.env.MPESA_ENV === "live"
        ? "https://api.safaricom.co.ke"
        : "https://sandbox.safaricom.co.ke";

    console.log("🌍 [M-PESA INIT] Environment & config:", {
      MPESA_ENV: process.env.MPESA_ENV || "sandbox (default)",
      shortcode,
      tillNumber,
      callbackUrl,
      consumerKey: redact(consumerKey),
      consumerSecret: redact(consumerSecret),
      passkey: redact(passkey),
      baseUrl,
    });

    if (!consumerKey || !consumerSecret || !passkey) {
      console.error("[M-PESA INIT] Missing required M-Pesa credentials");
      return NextResponse.json(
        {
          error:
            "M-Pesa configuration error. Please contact support if this persists.",
        },
        { status: 500 },
      );
    }

    // 1️⃣ Generate OAuth Token
    const auth = Buffer.from(`${consumerKey}:${consumerSecret}`).toString(
      "base64",
    );

    const tokenRes = await fetch(
      `${baseUrl}/oauth/v1/generate?grant_type=client_credentials`,
      {
        headers: { Authorization: `Basic ${auth}` },
        // ensure no caching
        cache: "no-store",
      },
    );

    if (!tokenRes.ok) {
      const text = await tokenRes.text().catch(() => "");
      console.error("[M-PESA INIT] OAuth token error:", {
        status: tokenRes.status,
        text,
      });
      return NextResponse.json(
        {
          error:
            "Failed to contact M-Pesa gateway (token). Please try again later.",
        },
        { status: 502 },
      );
    }

    const tokenData = await tokenRes.json();
    console.log("🔑 [M-PESA INIT] OAuth Token response:", tokenData);

    const accessToken = tokenData.access_token as string | undefined;
    if (!accessToken) {
      console.error(
        "[M-PESA INIT] No access_token in OAuth response:",
        tokenData,
      );
      return NextResponse.json(
        { error: "Failed to obtain access token from M-Pesa" },
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
      BusinessShortCode: shortcode,
      Password: password,
      Timestamp: timestamp,
      TransactionType: "CustomerBuyGoodsOnline", // For Till Number
      Amount: parsedAmount,
      PartyA: sanitizedPhone, // Customer number
      PartyB: tillNumber, // Till number
      PhoneNumber: sanitizedPhone,
      CallBackURL: callbackUrl,
      AccountReference: accountReference || bookingId,
      TransactionDesc: description || `Booking ${bookingId}`,
    };

    console.log("📦 [M-PESA INIT] STK Payload:", {
      ...stkPayload,
      PartyA: "***redacted***",
      PhoneNumber: "***redacted***",
    });

    // 3️⃣ Trigger STK Push
    const stkRes = await fetch(
      `${baseUrl}/mpesa/stkpush/v1/processrequest`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(stkPayload),
      },
    );

    const rawText = await stkRes.text();
    let stkData: any;
    try {
      stkData = JSON.parse(rawText);
    } catch {
      stkData = rawText;
    }

    console.log("📡 [M-PESA INIT] STK Push response:", {
      status: stkRes.status,
      body: stkData,
    });

    if (!stkRes.ok) {
      return NextResponse.json(
        {
          error:
            stkData?.errorMessage ||
            "Failed to initiate M-Pesa payment. Please try again.",
          details: stkData,
        },
        { status: 502 },
      );
    }

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
      // Don't fail the client just because we couldn't store metadata;
      // the callback may still succeed based on other identifiers.
    }

    return NextResponse.json(stkData, { status: 200 });
  } catch (error: any) {
    console.error("❌ [M-PESA INIT ERROR]:", error?.message || error);
    return NextResponse.json(
      {
        error:
          error?.message ||
          "Unexpected error while starting M-Pesa payment. Please try again.",
      },
      { status: 500 },
    );
  }
}