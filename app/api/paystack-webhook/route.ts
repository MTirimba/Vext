// /workspaces/Vext/app/api/paystack-webhook/route.ts
import { NextResponse } from "next/server";
import crypto from "crypto";
import { adminDb } from "@/lib/firebaseAdmin";

/**
 * Universal Paystack webhook for both payments & payouts
 */
export async function POST(req: Request) {
  try {
    const payload = await req.text();
    const signature = req.headers.get("x-paystack-signature") || "";
    const secret = process.env.PAYSTACK_SECRET_KEY || "";

    const computedHash = crypto
      .createHmac("sha512", secret)
      .update(payload)
      .digest("hex");

    // ❌ Invalid webhook signature
    if (signature !== computedHash) {
      console.warn("⚠️ Invalid Paystack signature — ignoring request.");
      return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
    }

    const body = JSON.parse(payload);
    const event = body.event;
    const data = body.data || {};

    console.log(`📩 Paystack Webhook received: ${event}`, data);

    // === 1️⃣ Booking Payment (charge.success) ===
    if (event === "charge.success" && data.status === "success") {
      const bookingId = data.metadata?.bookingId;
      if (!bookingId) {
        console.warn("⚠️ charge.success without bookingId metadata");
      } else {
        const bookingRef = adminDb.collection("bookings").doc(bookingId);

        // ✅ Update booking record
        await bookingRef.set(
          {
            status: "confirmed",
            paymentReference: data.reference,
            updatedAt: new Date(),
          },
          { merge: true }
        );

        // ✅ Update provider balance
        const providerUid = data.metadata?.providerUid;
        const amount = data.amount / 100; // Convert from kobo
        const platformCut = amount * 0.1;
        const providerAmount = amount - platformCut;

        if (providerUid) {
          await adminDb
            .collection("users")
            .doc(providerUid)
            .set(
              {
                wallet: {
                  available: adminDb.FieldValue.increment(providerAmount),
                },
              },
              { merge: true }
            );

          await adminDb
            .collection("platform")
            .doc("earnings")
            .set(
              {
                totalEarnings: adminDb.FieldValue.increment(platformCut),
              },
              { merge: true }
            );
        }
      }
    }

    // === 2️⃣ Withdrawal Success ===
    if (event === "transfer.success") {
      const reference = data.reference;
      const indexDoc = await adminDb
        .collection("_withdrawal_index")
        .doc(reference)
        .get();

      if (indexDoc.exists) {
        const { providerId, withdrawalId } = indexDoc.data();
        const wRef = adminDb
          .collection("users")
          .doc(providerId)
          .collection("withdrawals")
          .doc(withdrawalId);

        await wRef.set(
          {
            status: "success",
            completedAt: new Date(),
            paystack: {
              transfer_code: data.transfer_code,
              status: data.status,
              reference: data.reference,
              transaction_date: data.transferred_at || new Date(),
            },
          },
          { merge: true }
        );

        console.log(`✅ Withdrawal ${withdrawalId} marked as success.`);
      } else {
        console.warn(`⚠️ No index found for withdrawal reference ${reference}`);
      }
    }

    // === 3️⃣ Withdrawal Failed or Reversed ===
    if (event === "transfer.failed" || event === "transfer.reversed") {
      const reference = data.reference;
      const indexDoc = await adminDb
        .collection("_withdrawal_index")
        .doc(reference)
        .get();

      if (indexDoc.exists) {
        const { providerId, withdrawalId } = indexDoc.data();

        const wRef = adminDb
          .collection("users")
          .doc(providerId)
          .collection("withdrawals")
          .doc(withdrawalId);

        await wRef.set(
          {
            status: "failed",
            failedAt: new Date(),
            paystack: {
              transfer_code: data.transfer_code,
              status: data.status,
              reason: data.reason || "Transfer failed or reversed",
            },
          },
          { merge: true }
        );

        console.log(`❌ Withdrawal ${withdrawalId} marked as failed/reversed.`);
      } else {
        console.warn(`⚠️ No index found for failed withdrawal ${reference}`);
      }
    }

    // ✅ ACK response
    return NextResponse.json({ received: true });
  } catch (err: any) {
    console.error("⚠️ Paystack Webhook Error:", err);
    return NextResponse.json(
      { error: "Webhook processing error" },
      { status: 500 }
    );
  }
}