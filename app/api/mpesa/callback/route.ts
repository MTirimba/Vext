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
      (e as any)?.message || e,
    );
  }

  console.log(
    "📥 [M-PESA STK CALLBACK] Raw body:",
    JSON.stringify(body, null, 2),
  );

  try {
    const callback = body?.Body?.stkCallback;
    if (!callback) {
      console.warn(
        "⚠️ [M-PESA STK CALLBACK] No Body.stkCallback in payload, echoing OK",
      );
      // Always ACK so Safaricom stops retrying
      return NextResponse.json({ ResultCode: 0, ResultDesc: "Accepted" });
    }

    const CheckoutRequestID = callback?.CheckoutRequestID;
    const ResultCodeRaw = callback?.ResultCode;
    const ResultDesc = callback?.ResultDesc;

    // Cast ResultCode to number to be safe (Daraja can send 0 or "0")
    const ResultCode = Number(ResultCodeRaw);

    console.log(
      "📌 [M-PESA STK CALLBACK] CheckoutRequestID:",
      CheckoutRequestID,
      "ResultCode:",
      ResultCode,
      "ResultDesc:",
      ResultDesc,
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

    // 🔎 Find booking by mpesaCheckoutRequestId
    let bookingId: string | null = null;
    if (CheckoutRequestID) {
      const snap = await adminDb
        .collection("bookings")
        .where("mpesaCheckoutRequestId", "==", CheckoutRequestID)
        .limit(1)
        .get();

      if (!snap.empty) {
        bookingId = snap.docs[0].id;
        console.log(
          "✅ [M-PESA STK CALLBACK] Matched booking:",
          bookingId,
          "for CheckoutRequestID:",
          CheckoutRequestID,
        );
      } else {
        console.warn(
          "⚠️ [M-PESA STK CALLBACK] No booking found for CheckoutRequestID:",
          CheckoutRequestID,
        );
      }
    } else {
      console.warn("⚠️ [M-PESA STK CALLBACK] Missing CheckoutRequestID");
    }

    // If we can't match a booking, we still ACK to Safaricom to stop retries.
    if (!bookingId) {
      return NextResponse.json({ ResultCode: 0, ResultDesc: "Accepted" });
    }

    const bookingRef = adminDb.collection("bookings").doc(bookingId);

    if (ResultCode === 0) {
      console.log(
        "✅ [M-PESA STK CALLBACK] Payment success, marking booking confirmed",
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
        { merge: true },
      );
    } else {
      console.log(
        "❌ [M-PESA STK CALLBACK] Payment failed/cancelled, marking booking payment_failed",
        ResultCode,
        ResultDesc,
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
        { merge: true },
      );
    }

    // Always ACK so Safaricom is happy
    return NextResponse.json({ ResultCode: 0, ResultDesc: "Accepted" });
  } catch (err: any) {
    console.error(
      "❌ [M-PESA STK CALLBACK ERROR]:",
      err?.message || err,
    );
    // Still ACK so Safaricom doesn't keep retrying forever
    return NextResponse.json({
      ResultCode: 0,
      ResultDesc: "Error logged",
    });
  }
}