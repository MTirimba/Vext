// /workspaces/Vext/app/api/withdraw-callback/route.ts
import { NextRequest, NextResponse } from "next/server";
import { adminDb } from "@/lib/firebaseAdmin";

/**
 * Helper to flatten ResultParameters -> key/value map
 */
function paramsToMap(resultParameters?: any): Record<string, any> {
  const map: Record<string, any> = {};
  const items =
    resultParameters?.ResultParameter ||
    resultParameters?.ResultParameters ||
    resultParameters;

  if (Array.isArray(items)) {
    for (const p of items) {
      const key = p?.Key ?? p?.key ?? p?.Name;
      const value = p?.Value ?? p?.value ?? p?.ParamValue;
      if (key) map[String(key)] = value;
    }
  } else if (items && typeof items === "object") {
    const arr = items.ResultParameter;
    if (Array.isArray(arr)) {
      for (const p of arr) {
        if (p?.Key) map[String(p.Key)] = p?.Value;
      }
    }
  }
  return map;
}

/**
 * Handles Safaricom B2C (Withdrawal) Callback
 */
export async function POST(req: NextRequest) {
  try {
    const data = await req.json();
    console.log("💰 Withdraw Callback received:", JSON.stringify(data, null, 2));

    const result = data?.Result || data?.result || {};
    const resultCode = Number(result?.ResultCode ?? 1);
    const resultDesc = result?.ResultDesc ?? "Unknown";
    const originatorConversationId = result?.OriginatorConversationID || null;
    const conversationId = result?.ConversationID || null;
    const transactionId = result?.TransactionID || null;

    // Extract the transaction details
    const paramMap = paramsToMap(result?.ResultParameters);
    const amount = Number(paramMap["TransactionAmount"] ?? 0) || 0;
    const receipt = paramMap["TransactionReceipt"] || null;
    const completionTime = paramMap["TransactionCompletionTime"] || null;
    const receiver = paramMap["ReceiverPartyPublicName"] || null;
    const feeRaw =
      paramMap["B2CChargesPaidAccountAvailableFunds"] ??
      paramMap["B2CChargePaid"] ??
      paramMap["B2CWorkingAccountCharges"] ??
      0;
    const fee = Number(feeRaw) || 0;

    // 🔎 Locate the corresponding withdrawal in Firestore
    if (!originatorConversationId) {
      console.warn("⚠️ Callback missing OriginatorConversationID — cannot locate withdrawal.");
      return NextResponse.json({ ResultCode: 0, ResultDesc: "OK" });
    }

    const indexDoc = await adminDb
      .collection("_withdrawal_index")
      .doc(originatorConversationId)
      .get();

    if (!indexDoc.exists) {
      console.warn("⚠️ No index document found for:", originatorConversationId);
      return NextResponse.json({ ResultCode: 0, ResultDesc: "OK" });
    }

    const { providerId, withdrawalId } = indexDoc.data() as {
      providerId: string;
      withdrawalId: string;
    };

    const wRef = adminDb
      .collection("users")
      .doc(providerId)
      .collection("withdrawals")
      .doc(withdrawalId);

    // ✅ Update withdrawal record
    const status = resultCode === 0 ? "completed" : "failed";

    await wRef.set(
      {
        status,
        amount,
        fee,
        net: Math.max(0, amount - fee),
        receipt,
        receiver,
        completionTime,
        updatedAt: new Date(),
        daraja: {
          ResultCode: resultCode,
          ResultDesc: resultDesc,
          ConversationID: conversationId,
          OriginatorConversationID: originatorConversationId,
          TransactionID: transactionId,
          rawParams: paramMap,
        },
      },
      { merge: true }
    );

    console.log(
      `✅ Withdrawal ${status.toUpperCase()} | providerId: ${providerId} | withdrawalId: ${withdrawalId}`
    );

    // ✅ Acknowledge Safaricom (very important)
    return NextResponse.json({ ResultCode: 0, ResultDesc: "Success" });
  } catch (err: any) {
    console.error("🔥 Withdraw Callback error:", err);
    return NextResponse.json(
      { ResultCode: 1, ResultDesc: "Callback processing error" },
      { status: 500 }
    );
  }
}
