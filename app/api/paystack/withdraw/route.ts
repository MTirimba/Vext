// /workspaces/Vext/app/api/paystack/withdraw/route.ts
import { NextRequest, NextResponse } from "next/server";
import { adminDb } from "@/lib/firebaseAdmin";

/**
 * Handles Paystack withdrawals (payouts)
 * Flow:
 * 1️⃣ Verify user & data
 * 2️⃣ Send transfer request to Paystack
 * 3️⃣ Log withdrawal in Firestore
 * 4️⃣ Create _withdrawal_index entry for webhook updates
 */

export async function POST(req: NextRequest) {
  try {
    const { uid, name, phoneNumber, amount, recipientCode } = await req.json();

    if (!uid || !name || !phoneNumber || !amount || !recipientCode) {
      return NextResponse.json(
        { error: "Missing required fields" },
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

    // ✅ Initiate transfer on Paystack
    const res = await fetch("https://api.paystack.co/transfer", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        source: "balance",
        amount: parsedAmount * 100, // Paystack uses kobo-like units
        recipient: recipientCode,
        reason: `Withdrawal by ${name}`,
        currency: "KES",
      }),
    });

    const paystackResponse = await res.json();
    console.log("💸 Paystack Transfer Response:", paystackResponse);

    if (!res.ok) {
      return NextResponse.json(
        { error: paystackResponse.message || "Paystack transfer failed" },
        { status: 400 }
      );
    }

    const transfer = paystackResponse.data;
    const transferCode = transfer.transfer_code;
    const reference = transfer.reference;

    // ✅ Log withdrawal in Firestore
    const withdrawalRef = await adminDb
      .collection("users")
      .doc(uid)
      .collection("withdrawals")
      .add({
        name,
        phone: phoneNumber,
        amount: parsedAmount,
        method: "paystack",
        recipientCode,
        status: "processing",
        reference,
        transferCode,
        createdAt: new Date(),
        paystack: {
          id: transfer.id,
          transfer_code: transfer.transfer_code,
          integration: transfer.integration,
          domain: transfer.domain,
          status: transfer.status,
        },
      });

    // ✅ Create an index document for webhook updates
    if (reference) {
      await adminDb.collection("_withdrawal_index").doc(reference).set({
        providerId: uid,
        withdrawalId: withdrawalRef.id,
        createdAt: new Date(),
      });
    }

    return NextResponse.json(
      {
        success: true,
        message: "Withdrawal request submitted successfully to Paystack",
        withdrawalId: withdrawalRef.id,
        paystackResponse,
      },
      { status: 200 }
    );
  } catch (err: any) {
    console.error("⚠️ Paystack withdrawal error:", err);
    return NextResponse.json(
      { error: err.message || "Internal server error" },
      { status: 500 }
    );
  }
}
