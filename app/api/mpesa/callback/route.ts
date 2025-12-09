// /workspaces/Vext/app/api/mpesa/callback/route.ts
import { NextRequest, NextResponse } from "next/server";
import { adminDb } from "@/lib/firebaseAdmin";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  console.log("📥 [M-PESA STK CALLBACK] HIT /api/mpesa/callback");

  let body: any = {};
  try {
    body = await req.json();
  } catch (e) {
    console.error(
      "❌ [M-PESA STK CALLBACK] Failed to parse JSON body:",
      (e as any)?.message || e
    );
  }

  console.log(
    "📥 [M-PESA STK CALLBACK] Raw body:",
    JSON.stringify(body, null, 2)
  );

  try {
    const callback = body?.Body?.stkCallback;
    if (!callback) {
      console.warn(
        "⚠️ [M-PESA STK CALLBACK] No Body.stkCallback in payload, echoing OK"
      );
      return NextResponse.json({ ResultCode: 0, ResultDesc: "Accepted" });
    }

    const CheckoutRequestID = callback?.CheckoutRequestID as string | undefined;
    const ResultCodeRaw = callback?.ResultCode;
    const ResultDesc = callback?.ResultDesc;

    const ResultCode = Number(ResultCodeRaw);

    console.log(
      "📌 [M-PESA STK CALLBACK] CheckoutRequestID:",
      CheckoutRequestID,
      "ResultCode:",
      ResultCode,
      "ResultDesc:",
      ResultDesc
    );

    let amount: number | null = null;
    let receipt: string | null = null;
    let phone: string | null = null;
    let txDate: number | null = null;

    const items = callback?.CallbackMetadata?.Item || [];
    for (const item of items) {
      if (item.Name === "Amount") amount = Number(item.Value);
      if (item.Name === "MpesaReceiptNumber") receipt = String(item.Value);
      if (item.Name === "PhoneNumber") phone = String(item.Value);
      if (item.Name === "TransactionDate") txDate = Number(item.Value);
    }

    console.log("💰 [M-PESA STK CALLBACK] Parsed metadata:", {
      amount,
      receipt,
      phone,
      txDate,
    });

    if (!CheckoutRequestID) {
      console.warn("⚠️ [M-PESA STK CALLBACK] Missing CheckoutRequestID");
      return NextResponse.json({ ResultCode: 0, ResultDesc: "Accepted" });
    }

    // 🔎 Try to match booking AND walletTopup in parallel
    const [bookingSnap, walletTopupSnap] = await Promise.all([
      adminDb
        .collection("bookings")
        .where("mpesaCheckoutRequestId", "==", CheckoutRequestID)
        .limit(1)
        .get(),
      adminDb.collection("walletTopups").doc(CheckoutRequestID).get(),
    ]);

    let bookingId: string | null = null;
    if (!bookingSnap.empty) {
      bookingId = bookingSnap.docs[0].id;
      console.log(
        "✅ [M-PESA STK CALLBACK] Matched booking:",
        bookingId,
        "for CheckoutRequestID:",
        CheckoutRequestID
      );
    } else {
      console.log(
        "ℹ️ [M-PESA STK CALLBACK] No booking found for CheckoutRequestID:",
        CheckoutRequestID
      );
    }

    let walletUserId: string | null = null;
    let walletRequestedAmount: number | null = null;

    if (walletTopupSnap.exists) {
      const d = walletTopupSnap.data() as any;
      walletUserId = (d && d.userId) || null;
      walletRequestedAmount =
        typeof d?.amount === "number" ? d.amount : Number(d?.amount) || null;

      console.log(
        "✅ [M-PESA STK CALLBACK] Matched walletTopup for CheckoutRequestID:",
        CheckoutRequestID,
        "user:",
        walletUserId
      );
    } else {
      console.log(
        "ℹ️ [M-PESA STK CALLBACK] No walletTopup mapping for CheckoutRequestID:",
        CheckoutRequestID
      );
    }

    // If neither booking nor wallet flow matched, just ACK so M-Pesa stops retrying
    if (!bookingId && !walletUserId) {
      console.warn(
        "⚠️ [M-PESA STK CALLBACK] No booking or walletTopup found for CheckoutRequestID:",
        CheckoutRequestID
      );
      return NextResponse.json({ ResultCode: 0, ResultDesc: "Accepted" });
    }

    // 1️⃣ Booking flow
    if (bookingId) {
      const bookingRef = adminDb.collection("bookings").doc(bookingId);

      if (ResultCode === 0) {
        console.log(
          "✅ [M-PESA STK CALLBACK] Payment success, marking booking confirmed"
        );
        await bookingRef.set(
          {
            status: "confirmed",
            paymentStatus: "paid",
            paymentMethod: "mpesa",
            paymentRef: receipt || CheckoutRequestID || null,
            mpesaAmount: amount,
            mpesaPhone: phone,
            mpesaTransactionDate: txDate,
            mpesaResultCode: ResultCode,
            mpesaResultDesc: ResultDesc,
            mpesaCallbackAt: Date.now(),
          },
          { merge: true }
        );
      } else {
        console.log(
          "❌ [M-PESA STK CALLBACK] Payment failed/cancelled, marking booking payment_failed",
          ResultCode,
          ResultDesc
        );
        await bookingRef.set(
          {
            status: "payment_failed",
            paymentStatus: "failed",
            paymentMethod: "mpesa",
            mpesaAmount: amount,
            mpesaPhone: phone,
            mpesaTransactionDate: txDate,
            mpesaResultCode: ResultCode,
            mpesaResultDesc: ResultDesc,
            mpesaCallbackAt: Date.now(),
          },
          { merge: true }
        );
      }
    }

    // 2️⃣ Wallet deposit flow
    if (walletUserId) {
      const statusLabel = ResultCode === 0 ? "completed" : "failed";
      const userId = walletUserId;
      const txAmount = amount ?? walletRequestedAmount ?? 0;

      console.log(
        "🏦 [M-PESA STK CALLBACK] Handling wallet deposit for user:",
        userId,
        "status:",
        statusLabel
      );

      // Create wallet transaction (this is what the client listens to)
      const walletTxRef = adminDb
        .collection("users")
        .doc(userId)
        .collection("walletTransactions")
        .doc();

      await walletTxRef.set({
        amount: txAmount,
        type: "credit",
        reason: "wallet_deposit",
        status: statusLabel,
        mpesaReceipt: receipt || CheckoutRequestID || null,
        mpesaPhone: phone,
        mpesaTransactionDate: txDate,
        mpesaResultCode: ResultCode,
        mpesaResultDesc: ResultDesc,
        createdAt: Date.now(),
      });

      // Update walletTopups helper doc
      await adminDb
        .collection("walletTopups")
        .doc(CheckoutRequestID)
        .set(
          {
            status: statusLabel,
            walletTxId: walletTxRef.id,
            mpesaAmount: amount,
            mpesaPhone: phone,
            mpesaTransactionDate: txDate,
            mpesaResultCode: ResultCode,
            mpesaResultDesc: ResultDesc,
            mpesaCallbackAt: Date.now(),
          },
          { merge: true }
        );
    }

    // Always ACK so Safaricom is happy
    return NextResponse.json({ ResultCode: 0, ResultDesc: "Accepted" });
  } catch (err: any) {
    console.error("❌ [M-PESA STK CALLBACK ERROR]:", err?.message || err);
    // Still ACK so Safaricom doesn't keep retrying forever
    return NextResponse.json({
      ResultCode: 0,
      ResultDesc: "Error logged",
    });
  }
}