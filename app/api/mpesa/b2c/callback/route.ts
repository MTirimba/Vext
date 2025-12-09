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
    const resultCode: number = Number(result.ResultCode);
    const resultDesc: string = String(result.ResultDesc ?? "");

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

    if (!originatorConversationId && !conversationId) {
      console.warn(
        "[M-PESA B2C CALLBACK] Missing both OriginatorConversationID and ConversationID; cannot map to withdrawal",
      );
      return NextResponse.json({ ResultCode: 0, ResultDesc: "Accepted" });
    }

    // 🔎 Step 1: Find the withdrawal doc using collectionGroup
    let withdrawalSnap:
      FirebaseFirestore.QuerySnapshot<FirebaseFirestore.DocumentData> | null =
      null;

    if (originatorConversationId) {
      console.log(
        "[M-PESA B2C CALLBACK] Querying withdrawals by originatorConversationId:",
        originatorConversationId,
      );
      withdrawalSnap = await adminDb
        .collectionGroup("withdrawals")
        .where("originatorConversationId", "==", originatorConversationId)
        .limit(1)
        .get();
    }

    if ((!withdrawalSnap || withdrawalSnap.empty) && conversationId) {
      console.log(
        "[M-PESA B2C CALLBACK] No match by originatorConversationId; querying by conversationId:",
        conversationId,
      );
      withdrawalSnap = await adminDb
        .collectionGroup("withdrawals")
        .where("conversationId", "==", conversationId)
        .limit(1)
        .get();
    }

    if (!withdrawalSnap || withdrawalSnap.empty) {
      console.warn(
        "[M-PESA B2C CALLBACK] No matching withdrawal found for IDs",
        { originatorConversationId, conversationId },
      );
      return NextResponse.json({ ResultCode: 0, ResultDesc: "Accepted" });
    }

    const withdrawalDoc = withdrawalSnap.docs[0];
    const withdrawalRef = withdrawalDoc.ref;
    const withdrawalData = withdrawalDoc.data() as any;

    // Parent of the withdrawals collection is users/{userId}
    const userDocRef = withdrawalRef.parent.parent;
    const userId = userDocRef?.id;

    if (!userId) {
      console.warn(
        "[M-PESA B2C CALLBACK] Could not determine userId from withdrawal path:",
        withdrawalRef.path,
      );
      return NextResponse.json({ ResultCode: 0, ResultDesc: "Accepted" });
    }

    const status = resultCode === 0 ? "success" : "failed";

    await withdrawalRef.set(
      {
        status,
        mpesaResultCode: resultCode,
        mpesaResultDesc: resultDesc,
        mpesaConversationId: conversationId || withdrawalData.conversationId || null,
        mpesaOriginatorConversationId:
          originatorConversationId || withdrawalData.originatorConversationId || null,
        mpesaAmount: amount ?? withdrawalData.amount ?? null,
        mpesaReceipt: receipt,
        mpesaReceiver: receiver,
        mpesaCompletedAt: completedAt,
        mpesaRawCallback: body,
        updatedAt: Date.now(),
      },
      { merge: true },
    );

    console.log("✅ [M-PESA B2C CALLBACK] Withdrawal doc updated:", {
      path: withdrawalRef.path,
      status,
    });

    // 💰 Step 2: Only debit wallet on successful payout
    if (resultCode === 0) {
      const debitAmount = amount ?? withdrawalData.amount ?? 0;

      if (!debitAmount || debitAmount <= 0) {
        console.warn(
          "[M-PESA B2C CALLBACK] debitAmount is invalid, skipping wallet debit",
          {
            amount,
            withdrawalAmount: withdrawalData.amount,
          },
        );
      } else {
        const walletTxRef = adminDb
          .collection("users")
          .doc(userId)
          .collection("walletTransactions")
          // deterministic id so repeated callbacks don't double-debit
          .doc(`withdrawal_${withdrawalRef.id}`);

        await walletTxRef.set(
          {
            amount: debitAmount,
            type: "debit",
            reason: "wallet_withdraw",
            status: "completed",
            bookingId: null,
            createdAt: Date.now(),
            b2cConversationId: conversationId || null,
            b2cOriginatorConversationId: originatorConversationId || null,
            mpesaReceipt: receipt || null,
          },
          { merge: true },
        );

        console.log("💸 [M-PESA B2C CALLBACK] Wallet debit recorded:", {
          userId,
          txPath: walletTxRef.path,
          amount: debitAmount,
        });
      }
    } else {
      console.log(
        "⚠️ [M-PESA B2C CALLBACK] ResultCode not 0; marking withdrawal failed and leaving wallet balance unchanged",
      );
    }

    // ACK to Safaricom so it stops retrying
    return NextResponse.json({ ResultCode: 0, ResultDesc: "Accepted" });
  } catch (err: any) {
    console.error("❌ [M-PESA B2C CALLBACK ERROR]:", err?.message || err);
    // Still ACK, but log the error
    return NextResponse.json({ ResultCode: 0, ResultDesc: "Error logged" });
  }
}