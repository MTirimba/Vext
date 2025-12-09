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

    // ─────────────────────────────────────────────
    // 1️⃣ Find mapping → withdrawal document
    // ─────────────────────────────────────────────
    let mapping: {
      userId?: string;
      withdrawalId?: string;
      conversationId?: string;
      amount?: number;
      phoneNumber?: string;
    } | null = null;

    // Prefer the inexpensive direct mapping document
    const mappingSnap = await adminDb
      .collection("mpesaWithdrawals")
      .doc(originatorConversationId)
      .get();

    if (mappingSnap.exists) {
      mapping = mappingSnap.data() as any;
      console.log(
        "[M-PESA B2C CALLBACK] Found mpesaWithdrawals mapping doc:",
        mapping,
      );
    } else {
      console.warn(
        "[M-PESA B2C CALLBACK] No mpesaWithdrawals mapping doc for OriginatorConversationID:",
        originatorConversationId,
      );

      // Fallback: search the withdrawals collection group by originatorConversationId
      const cgSnap = await adminDb
        .collectionGroup("withdrawals")
        .where("originatorConversationId", "==", originatorConversationId)
        .limit(1)
        .get();

      if (!cgSnap.empty) {
        const docSnap = cgSnap.docs[0];
        const ref = docSnap.ref;
        const userId = ref.parent.parent?.id; // users/{userId}/withdrawals/{withdrawalId}
        const withdrawalId = ref.id;

        mapping = {
          ...(docSnap.data() as any),
          userId,
          withdrawalId,
        };

        console.log(
          "[M-PESA B2C CALLBACK] Fallback mapping via collectionGroup:",
          {
            userId,
            withdrawalId,
            originatorConversationId,
          },
        );
      }
    }

    if (!mapping || !mapping.userId || !mapping.withdrawalId) {
      console.warn(
        "[M-PESA B2C CALLBACK] Could not resolve mapping to withdrawal document:",
        mapping,
      );
      return NextResponse.json({ ResultCode: 0, ResultDesc: "Accepted" });
    }

    const { userId, withdrawalId } = mapping;
    const withdrawalRef = adminDb.doc(
      `users/${userId}/withdrawals/${withdrawalId}`,
    );

    const status = resultCode === 0 ? "success" : "failed";

    // ─────────────────────────────────────────────
    // 2️⃣ Update withdrawal history document
    // ─────────────────────────────────────────────
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

    console.log("✅ [M-PESA B2C CALLBACK] Withdrawal doc updated:", {
      path: withdrawalRef.path,
      status,
    });

    // ─────────────────────────────────────────────
    // 3️⃣ On success, create walletTransactions debit
    // ─────────────────────────────────────────────
    if (status === "success") {
      const finalAmount =
        amount ??
        (typeof mapping.amount === "number" ? mapping.amount : null) ??
        0;

      const walletTxRef = adminDb
        .collection("users")
        .doc(userId)
        .collection("walletTransactions")
        .doc(); // auto-id

      await walletTxRef.set({
        amount: finalAmount,
        type: "debit",
        reason: "wallet_withdraw",
        status: "completed",
        relatedWithdrawalId: withdrawalId,
        createdAt: Date.now(),
      });

      console.log("💸 [M-PESA B2C CALLBACK] Wallet debit created:", {
        path: walletTxRef.path,
        amount: finalAmount,
      });
    } else {
      console.log(
        "ℹ️ [M-PESA B2C CALLBACK] Withdrawal not successful; wallet balance unchanged.",
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