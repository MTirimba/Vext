// /workspaces/Vext/app/api/mpesa/b2c/callback/route.ts
import { NextRequest, NextResponse } from "next/server";
import { adminDb } from "@/lib/firebaseAdmin";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  console.log("📥 [M-PESA B2C CALLBACK] HIT /api/mpesa/b2c/callback");

  let body: any = {};
  try {
    body = await req.json();
  } catch {
    console.error("❌ [M-PESA B2C CALLBACK] Failed to parse JSON body");
  }

  console.log(
    "📥 [M-PESA B2C CALLBACK] Raw body:",
    JSON.stringify(body, null, 2),
  );

  try {
    const result = body?.Result;
    if (!result) {
      console.warn("⚠️ [M-PESA B2C CALLBACK] No Result object in payload");
      // Still ACK so Safaricom stops retrying
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

    // Extract common parameters
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

    // 🔎 Find the corresponding withdrawal doc using collectionGroup on "withdrawals"
    let withdrawalRef: FirebaseFirestore.DocumentReference | null = null;

    if (originatorConversationId) {
      console.log(
        "[M-PESA B2C CALLBACK] Querying by originatorConversationId:",
        originatorConversationId,
      );
      const snap = await adminDb
        .collectionGroup("withdrawals")
        .where("originatorConversationId", "==", originatorConversationId)
        .limit(1)
        .get();

      console.log(
        "[M-PESA B2C CALLBACK] Query by originatorConversationId returned docs:",
        snap.size,
      );

      if (!snap.empty) {
        withdrawalRef = snap.docs[0].ref;
        console.log(
          "[M-PESA B2C CALLBACK] Matched withdrawal doc (originatorConversationId):",
          snap.docs[0].id,
        );
      }
    }

    if (!withdrawalRef && conversationId) {
      console.log(
        "[M-PESA B2C CALLBACK] Querying by conversationId:",
        conversationId,
      );
      const snap2 = await adminDb
        .collectionGroup("withdrawals")
        .where("conversationId", "==", conversationId)
        .limit(1)
        .get();

      console.log(
        "[M-PESA B2C CALLBACK] Query by conversationId returned docs:",
        snap2.size,
      );

      if (!snap2.empty) {
        withdrawalRef = snap2.docs[0].ref;
        console.log(
          "[M-PESA B2C CALLBACK] Matched withdrawal doc (conversationId):",
          snap2.docs[0].id,
        );
      }
    }

    if (!withdrawalRef) {
      console.warn(
        "[M-PESA B2C CALLBACK] No matching withdrawal document found for IDs:",
        { originatorConversationId, conversationId },
      );
      // Still ACK the callback so Safaricom stops retrying
      return NextResponse.json({ ResultCode: 0, ResultDesc: "Accepted" });
    }

    // ✅ Update withdrawal status based on ResultCode
    if (resultCode === 0) {
      console.log(
        "✅ [M-PESA B2C CALLBACK] Payment success, marking withdrawal as success",
      );
      await withdrawalRef.set(
        {
          status: "success",
          mpesaResultCode: resultCode,
          mpesaResultDesc: resultDesc,
          mpesaConversationId: conversationId || null,
          mpesaOriginatorConversationId: originatorConversationId || null,
          mpesaReceipt: receipt,
          mpesaAmount: amount,
          mpesaReceiver: receiver,
          mpesaCompletedAt: completedAt,
          mpesaRawCallback: body,
          updatedAt: Date.now(),
        },
        { merge: true },
      );
      console.log(
        "✅ [M-PESA B2C CALLBACK] Withdrawal doc updated to success.",
      );
    } else {
      console.log(
        "❌ [M-PESA B2C CALLBACK] Payment failed",
        resultCode,
        resultDesc,
      );
      await withdrawalRef.set(
        {
          status: "failed",
          mpesaResultCode: resultCode,
          mpesaResultDesc: resultDesc,
          mpesaConversationId: conversationId || null,
          mpesaOriginatorConversationId: originatorConversationId || null,
          mpesaRawCallback: body,
          updatedAt: Date.now(),
        },
        { merge: true },
      );
      console.log(
        "❌ [M-PESA B2C CALLBACK] Withdrawal doc updated to failed.",
      );
    }

    // ACK to Safaricom
    return NextResponse.json({ ResultCode: 0, ResultDesc: "Accepted" });
  } catch (err: any) {
    console.error("❌ [M-PESA B2C CALLBACK ERROR]:", err?.message || err);
    // Still acknowledge to stop retries
    return NextResponse.json({ ResultCode: 0, ResultDesc: "Error logged" });
  }
}