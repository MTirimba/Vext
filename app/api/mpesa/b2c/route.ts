// /workspaces/Vext/app/api/mpesa/b2c/route.ts
import { NextRequest, NextResponse } from "next/server";
import { adminDb } from "@/lib/firebaseAdmin";

export const runtime = "nodejs";

// Normalize MPESA_ENV and decide base URL
const MPESA_ENV = (process.env.MPESA_ENV || "sandbox").toLowerCase();
const IS_LIVE = MPESA_ENV === "live" || MPESA_ENV === "production";

const MPESA_BASE_URL = IS_LIVE
  ? "https://api.safaricom.co.ke"
  : "https://sandbox.safaricom.co.ke";

// Use your dedicated B2C credentials
const CONSUMER_KEY = process.env.MPESA_CONSUMER_KEY || "";
const CONSUMER_SECRET = process.env.MPESA_CONSUMER_SECRET || "";

const B2C_SHORTCODE = process.env.MPESA_B2C_SHORTCODE || ""; // e.g. 3003129 (live) / 600986 (sandbox)
const B2C_INITIATOR_NAME = process.env.MPESA_B2C_INITIATOR_NAME || "";
const B2C_SECURITY_CREDENTIAL =
  process.env.MPESA_B2C_SECURITY_CREDENTIAL || "";

const B2C_RESULT_URL = process.env.MPESA_B2C_RESULT_URL || "";
const B2C_TIMEOUT_URL = process.env.MPESA_B2C_TIMEOUT_URL || "";

// Use v3 in sandbox, v1 in live (per Safaricom behaviour)
const B2C_ENDPOINT_PATH = IS_LIVE
  ? "/mpesa/b2c/v1/paymentrequest"
  : "/mpesa/b2c/v3/paymentrequest";

async function getAccessToken() {
  if (!CONSUMER_KEY || !CONSUMER_SECRET) {
    console.error(
      "[M-Pesa B2C] Missing CONSUMER_KEY / CONSUMER_SECRET in env. " +
        "Check MPESA_CONSUMER_KEY / MPESA_CONSUMER_SECRET."
    );
    throw new Error("M-Pesa B2C credentials not configured");
  }

  const auth = Buffer.from(`${CONSUMER_KEY}:${CONSUMER_SECRET}`).toString(
    "base64"
  );

  console.log("[M-Pesa B2C] Requesting OAuth token", {
    env: MPESA_ENV,
    baseUrl: MPESA_BASE_URL,
  });

  const res = await fetch(
    `${MPESA_BASE_URL}/oauth/v1/generate?grant_type=client_credentials`,
    {
      headers: {
        Authorization: `Basic ${auth}`,
      },
    }
  );

  if (!res.ok) {
    let text = "";
    try {
      text = await res.text();
    } catch {
      // ignore
    }
    console.error(
      "[M-Pesa B2C] OAuth error status:",
      res.status,
      "body:",
      text
    );
    throw new Error(`Failed to get access token: ${text}`);
  }

  const data = (await res.json()) as { access_token: string };
  console.log("[M-Pesa B2C] OAuth success, keys:", Object.keys(data));
  if (!data.access_token) {
    console.error("[M-Pesa B2C] OAuth response missing access_token:", data);
    throw new Error("Failed to get access token (no access_token field)");
  }

  console.log(
    "[M-Pesa B2C] access_token length:",
    String(data.access_token).length
  );

  return data.access_token;
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    console.log("[M-Pesa B2C] Incoming /api/mpesa/b2c request body:", body);

    const userId = String(body.userId || "").trim();
    const withdrawalId = String(body.withdrawalId || "").trim();

    const amount = Number(body.amount);
    const phoneNumber = String(body.phoneNumber || "").trim();
    const remarks =
      (body.remarks as string | undefined) || "Provider withdrawal";

    if (!amount || amount <= 0) {
      console.warn("[M-Pesa B2C] Invalid amount provided:", amount);
      return NextResponse.json(
        { error: "Invalid amount provided." },
        { status: 400 }
      );
    }

    if (!phoneNumber) {
      console.warn("[M-Pesa B2C] Missing phoneNumber in request body");
      return NextResponse.json(
        { error: "phoneNumber is required." },
        { status: 400 }
      );
    }

    if (!userId || !withdrawalId) {
      console.warn("[M-Pesa B2C] Missing userId or withdrawalId from client", {
        userId,
        withdrawalId,
      });
      return NextResponse.json(
        { error: "userId and withdrawalId are required." },
        { status: 400 }
      );
    }

    // Basic env sanity checks (so we fail early & clearly)
    if (
      !B2C_SHORTCODE ||
      !B2C_INITIATOR_NAME ||
      !B2C_SECURITY_CREDENTIAL ||
      !B2C_RESULT_URL ||
      !B2C_TIMEOUT_URL
    ) {
      console.error("[M-Pesa B2C] Missing one or more B2C env values:", {
        hasShortcode: !!B2C_SHORTCODE,
        hasInitiator: !!B2C_INITIATOR_NAME,
        hasSecCred: !!B2C_SECURITY_CREDENTIAL,
        hasResultUrl: !!B2C_RESULT_URL,
        hasTimeoutUrl: !!B2C_TIMEOUT_URL,
      });
      return NextResponse.json(
        {
          error:
            "M-Pesa B2C not fully configured. Check MPESA_B2C_* env variables.",
        },
        { status: 500 }
      );
    }

    // react-phone-number-input gives +2547...
    // Safaricom expects 2547XXXXXXXX
    const normalizedPhone = phoneNumber
      .replace(/\s+/g, "")
      .replace(/^\+/, "");

    console.log("[M-Pesa B2C] Normalized request data:", {
      amount,
      phoneNumber,
      normalizedPhone,
      env: MPESA_ENV,
      baseUrl: MPESA_BASE_URL,
      endpointPath: B2C_ENDPOINT_PATH,
      userId,
      withdrawalId,
    });

    const token = await getAccessToken();

    const payload = {
      // OriginatorConversationID is returned by Safaricom in the response;
      // we don't rely on setting it here.
      InitiatorName: B2C_INITIATOR_NAME,
      SecurityCredential: B2C_SECURITY_CREDENTIAL,
      CommandID: "BusinessPayment", // or 'SalaryPayment' / 'PromotionPayment'
      Amount: amount,
      PartyA: B2C_SHORTCODE, // your shortcode
      PartyB: normalizedPhone, // customer phone, e.g. 2547XXXXXXXX
      Remarks: remarks,
      QueueTimeOutURL: B2C_TIMEOUT_URL,
      ResultURL: B2C_RESULT_URL,
      Occasion: "Withdrawal",
    };

    console.log(
      "[M-Pesa B2C] Outgoing payload:",
      JSON.stringify(
        {
          ...payload,
          // hide sensitive fields in logs
          SecurityCredential: "***",
        },
        null,
        2
      )
    );

    const res = await fetch(`${MPESA_BASE_URL}${B2C_ENDPOINT_PATH}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    const data = await res.json().catch(() => ({} as any));

    console.log(
      "[M-Pesa B2C] Raw Safaricom response:",
      res.status,
      JSON.stringify(data, null, 2)
    );

    if (!res.ok) {
      console.error(
        "[M-Pesa B2C] error response:",
        res.status,
        JSON.stringify(data, null, 2)
      );
      return NextResponse.json(
        {
          error:
            (data as any)?.errorMessage ||
            (data as any)?.errorCode ||
            "M-Pesa B2C request failed",
          mpesaResponse: data,
        },
        { status: 500 }
      );
    }

    console.log(
      "[M-Pesa B2C] Success response:",
      JSON.stringify(data, null, 2)
    );

    // Safaricom returns its own OriginatorConversationID / ConversationID
    const originatorConversationId =
      (data as any)?.OriginatorConversationID || null;
    const conversationId = (data as any)?.ConversationID || null;

    // 🔗 Store mapping doc for callback to locate withdrawal
    try {
      if (originatorConversationId) {
        await adminDb
          .collection("mpesaWithdrawals")
          .doc(originatorConversationId)
          .set(
            {
              userId,
              withdrawalId,
              amount,
              phoneNumber: normalizedPhone,
              conversationId,
              createdAt: Date.now(),
              mpesaInitResponse: data,
            },
            { merge: true }
          );

        console.log(
          "[M-Pesa B2C] Mapping doc created in mpesaWithdrawals:",
          {
            originatorConversationId,
            userId,
            withdrawalId,
          }
        );
      } else {
        console.warn(
          "[M-Pesa B2C] No OriginatorConversationID in response; mapping doc not created"
        );
      }

      // also patch the withdrawal document with IDs (for debugging / history)
      const withdrawalRef = adminDb.doc(
        `users/${userId}/withdrawals/${withdrawalId}`
      );
      await withdrawalRef.set(
        {
          originatorConversationId,
          conversationId,
          mpesaInitResponse: data,
          updatedAt: Date.now(),
        },
        { merge: true }
      );
      console.log(
        "[M-Pesa B2C] Withdrawal doc updated with M-Pesa IDs:",
        withdrawalRef.path
      );
    } catch (mapErr) {
      console.error(
        "[M-Pesa B2C] Failed to create mapping doc or update withdrawal:",
        mapErr
      );
    }

    return NextResponse.json(
      {
        mpesaResponse: data,
      },
      { status: 200 }
    );
  } catch (err: any) {
    console.error("B2C API route error:", err);
    return NextResponse.json(
      { error: err?.message || "Internal server error" },
      { status: 500 }
    );
  }
}