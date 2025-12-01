// /workspaces/Vext/app/api/withdraw/route.ts
import { NextRequest, NextResponse } from "next/server";
import { adminDb } from "@/lib/firebaseAdmin";

/**
 * Environment Variables
 */
const DARAJA_CONSUMER_KEY = process.env.DARAJA_CONSUMER_KEY!;
const DARAJA_CONSUMER_SECRET = process.env.DARAJA_CONSUMER_SECRET!;
const DARAJA_SHORTCODE = process.env.DARAJA_SHORTCODE!;
const DARAJA_INITIATOR = process.env.DARAJA_INITIATOR!;
const DARAJA_SECURITY_CREDENTIAL = process.env.DARAJA_SECURITY_CREDENTIAL!;
const DARAJA_ENV = process.env.DARAJA_ENV || "sandbox";
const TIMEOUT_URL = process.env.MPESA_B2C_QUEUE_TIMEOUT_URL!;
const RESULT_URL = process.env.MPESA_B2C_RESULT_URL!;

const BASE_URL =
  DARAJA_ENV === "production"
    ? "https://api.safaricom.co.ke"
    : "https://sandbox.safaricom.co.ke";

/**
 * Generate OAuth Access Token
 */
async function getAccessToken(): Promise<string> {
  const auth = Buffer.from(
    `${DARAJA_CONSUMER_KEY}:${DARAJA_CONSUMER_SECRET}`
  ).toString("base64");

  const res = await fetch(
    `${BASE_URL}/oauth/v1/generate?grant_type=client_credentials`,
    { headers: { Authorization: `Basic ${auth}` } }
  );

  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(`Failed to fetch Daraja token (${res.status}): ${t}`);
  }

  const data = await res.json();
  return data.access_token;
}

/**
 * POST /api/withdraw
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    console.log("Withdraw request received:", body);

    const { name, phoneNumber, amount } = body;
    if (!name || !phoneNumber || !amount) {
      return NextResponse.json(
        { error: "Missing required fields: name, phoneNumber, amount" },
        { status: 400 }
      );
    }

    const parsedAmount = Number(amount);
    if (isNaN(parsedAmount) || parsedAmount <= 0) {
      return NextResponse.json(
        { error: "Invalid withdrawal amount" },
        { status: 400 }
      );
    }

    // 🔎 Find provider by payout_phone
    const provSnap = await adminDb
      .collection("users")
      .where("payout_phone", "==", phoneNumber)
      .limit(1)
      .get();

    if (provSnap.empty) {
      return NextResponse.json(
        {
          error:
            "No provider found with that payout phone. Please set payout settings in your profile.",
        },
        { status: 404 }
      );
    }

    const providerDoc = provSnap.docs[0];
    const providerId = providerDoc.id;

    // ✅ Get access token
    const token = await getAccessToken();

    // ✅ Prepare Daraja B2C request payload
    const payload = {
      InitiatorName: DARAJA_INITIATOR,
      SecurityCredential: DARAJA_SECURITY_CREDENTIAL,
      CommandID: "BusinessPayment",
      Amount: parsedAmount,
      PartyA: DARAJA_SHORTCODE,
      PartyB: phoneNumber,
      Remarks: "Withdrawal Request",
      QueueTimeOutURL: TIMEOUT_URL,
      ResultURL: RESULT_URL,
      Occasion: "Withdrawal",
    };

    console.log("Sending payload to Daraja:", payload);

    const res = await fetch(`${BASE_URL}/mpesa/b2c/v1/paymentrequest`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    let darajaResponse;
    try {
      darajaResponse = await res.json();
    } catch {
      darajaResponse = { message: "Empty or invalid response from Daraja" };
    }

    console.log("Daraja API Response:", darajaResponse);

    if (!res.ok) {
      return NextResponse.json(
        {
          error:
            darajaResponse?.errorMessage ||
            darajaResponse?.ResponseDescription ||
            "Daraja request failed",
          details: darajaResponse,
        },
        { status: 500 }
      );
    }

    // ✅ Record pending withdrawal in Firestore
    const withdrawalRef = await adminDb
      .collection("users")
      .doc(providerId)
      .collection("withdrawals")
      .add({
        amount: parsedAmount,
        fee: 0,
        net: parsedAmount,
        method: "mpesa",
        status: "processing",
        phone: phoneNumber,
        name,
        createdAt: new Date(),
        daraja: {
          ConversationID: darajaResponse?.ConversationID || null,
          OriginatorConversationID:
            darajaResponse?.OriginatorConversationID || null,
          ResponseCode: darajaResponse?.ResponseCode || null,
          ResponseDescription: darajaResponse?.ResponseDescription || null,
        },
      });

    // ✅ Create index doc for callback reference
    const originId = darajaResponse?.OriginatorConversationID;
    if (originId) {
      await adminDb
        .collection("_withdrawal_index")
        .doc(originId)
        .set({
          providerId,
          withdrawalId: withdrawalRef.id,
          createdAt: new Date(),
        });
    }

    return NextResponse.json(
      {
        success: true,
        message: "Withdrawal request submitted successfully",
        darajaResponse,
        withdrawalId: withdrawalRef.id,
      },
      { status: 200 }
    );
  } catch (error: any) {
    console.error("Error in withdraw API:", error);
    return NextResponse.json(
      { error: error.message || "Internal server error" },
      { status: 500 }
    );
  }
}