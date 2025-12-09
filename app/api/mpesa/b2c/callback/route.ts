// /workspaces/Vext/app/api/mpesa/b2c/callback/route.ts
import { NextRequest, NextResponse } from "next/server";
import { adminDb } from "@/lib/firebaseAdmin";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  console.log("📥 [M-PESA B2C CALLBACK] HIT /api/mpesa/b2c/callback");

  let body: any = {};
  try {
    body = await req.json();
  } catch (e) {
    console.error("❌ [M-PESA B2C CALLBACK] Failed to parse JSON body", e);
  }

  console.log(
    "📥 [M-PESA B2C CALLBACK] Raw body:",
    JSON.stringify(body, null, 2),
  );

  try {
    const result = body?.Result;
    if (!result) {
      console.warn(
        "⚠️ [M-PESA B2C CALLBACK] No Result object in payload, ACK anyway",
      );
      return NextResponse.json({ ResultCode: 0, ResultDesc: "Accepted" });
    }

    const originatorConversationId: string | undefined =
      result.OriginatorConversationID;
    const conversationId: string | undefined = result.ConversationID;
    const resultCode: number = result.ResultCode;
    const resultDesc: string = result.ResultDesc;

    console.log("[M-PESA B2C CALLBACK] IDs:", {
      originatorConversationId,
      conversationId,
      resultCode,
      resultDesc,
    });

    // Extract commonly useful fields from ResultParameters
    let amount: number | null = null;
    let receipt: string | null = null;
    let receiver: string | null = null;
    let completedAt: string | null = null;

    const params = result?.ResultParameters?.ResultParameter || [];
    for (const p of params) {
      switch (p.Key) {
        case "TransactionAmount":
          amount = Number(p.Value);
          break;
        case "TransactionReceipt":
          receipt = String(p.Value);
          break;
        case "ReceiverPartyPublicName":
          receiver = String(p.Value);
          break;
        case "TransactionCompletedDateTime":
          completedAt = String(p.Value);
          break;
        default:
          break;
      }
    }

    console.log("[M-PESA B2C CALLBACK] Parsed parameters:", {
      amount,
      receipt,
      receiver,
      completedAt,
    });

    if (!originatorConversationId) {
      console.warn(
        "[M-PESA B2C CALLBACK] Missing OriginatorConversationID; cannot map to withdrawal",
      );
      return NextResponse.json({ ResultCode: 0, ResultDesc: "Accepted" });
    }

    // 🔎 Step 1: look up mapping in top-level mpesaWithdrawals collection
    const mappingSnap = await adminDb
      .collection("mpesaWithdrawals")
      .doc(originatorConversationId)
      .get();

    if (!mappingSnap.exists) {
      console.warn(
        "[M-PESA B2C CALLBACK] No mpesaWithdrawals mapping doc found for OriginatorConversationID:",
        originatorConversationId,
      );
      return NextResponse.json({ ResultCode: 0, ResultDesc: "Accepted" });
    }

    const mapping = mappingSnap.data() as {
      userId?: string;
      withdrawalId?: string;
      conversationId?: string;
    };

    if (!mapping.userId || !mapping.withdrawalId) {
      console.warn(
        "[M-PESA B2C CALLBACK] Mapping doc missing userId/withdrawalId:",
        mapping,
      );
      return NextResponse.json({ ResultCode: 0, ResultDesc: "Accepted" });
    }

    const withdrawalRef = adminDb.doc(
      `users/${mapping.userId}/withdrawals/${mapping.withdrawalId}`,
    );

    const status = resultCode === 0 ? "success" : "failed";

    await withdrawalRef.set(
      {
        status,
        mpesaResultCode: resultCode,
        mpesaResultDesc: resultDesc,
        mpesaConversationId: conversationId || mapping.conversationId || null,
        mpesaOriginatorConversationId: originatorConversationId,
        mpesaAmount: amount,
        mpesaReceipt: receipt,
        mpesaReceiver: receiver,
        mpesaCompletedAt: completedAt,
        mpesaRawCallback: body,
        updatedAt: Date.now(),
      },
      { merge: true },
    );

    console.log(
      "✅ [M-PESA B2C CALLBACK] Withdrawal doc updated:",
      {
        path: withdrawalRef.path,
        status,
      },
    );

    // ACK to Safaricom so it stops retrying
    return NextResponse.json({ ResultCode: 0, ResultDesc: "Accepted" });
  } catch (err: any) {
    console.error("❌ [M-PESA B2C CALLBACK ERROR]:", err?.message || err);
    // Still ACK, but log the error
    return NextResponse.json({ ResultCode: 0, ResultDesc: "Error logged" });
  }
}