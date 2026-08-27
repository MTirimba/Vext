// /workspaces/Vext/app/api/paystack-webhook/route.ts
import { NextResponse } from "next/server";
import crypto from "crypto";
import { adminDb } from "@/lib/firebaseAdmin";
import { confirmBookingCore } from "@/lib/confirmBookingCore";

/**
 * Universal Paystack webhook for both payments & payouts
 *
 * ⚠️ NOTE:
 * - Fee breakdown (platformFee / providerAmount) is computed by
 *   confirmBookingCore(), the same function /api/confirm-booking uses — this
 *   webhook is just a second, server-to-server route into it, using the
 *   amount from this signature-verified payload instead of trusting a
 *   client's claim that payment succeeded.
 * - confirmBookingCore() is idempotent: if /api/confirm-booking (triggered
 *   client-side right after the Paystack popup closes) already confirmed
 *   this booking, calling it again here is a harmless no-op.
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
        const amountPaid = typeof data.amount === "number" ? data.amount / 100 : null;

        // Always record the raw payment audit trail, regardless of whether
        // confirmation below succeeds — useful for reconciling any flagged
        // mismatch later.
        await bookingRef.set(
          {
            paymentRef: data.reference,
            paymentReference: data.reference, // legacy field name, kept for compatibility
            paymentMethod: "paystack",
            paymentStatus: "success",
            amountPaid,
            currency: data.currency || "KES",
            paystackEvent: event,
            paystackData: data,
            updatedAt: Date.now(),
          },
          { merge: true },
        );

        // 🔐 Confirm through the same path /api/confirm-booking uses, passing
        // the amount straight from this signature-verified payload — no need
        // to hit Paystack's API again, and no trusting the client.
        const result = await confirmBookingCore({
          bookingId,
          paymentRef: data.reference,
          method: "paystack",
          verifiedPaystackAmount: amountPaid ?? 0,
        });

        if (!result.ok) {
          // Don't throw — Paystack will retry the webhook on a non-2xx
          // response, and retrying won't fix a genuine amount mismatch.
          // Flag it for manual review instead.
          console.error(
            `⚠️ Paystack webhook: booking ${bookingId} not confirmed — ${result.body.error}`,
          );
          await bookingRef.set(
            { paymentIntegrityFlag: result.body.error, updatedAt: Date.now() },
            { merge: true },
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
        const { providerId, withdrawalId } = indexDoc.data() as {
          providerId: string;
          withdrawalId: string;
        };

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
          { merge: true },
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
        const { providerId, withdrawalId } = indexDoc.data() as {
          providerId: string;
          withdrawalId: string;
        };

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
          { merge: true },
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
      { status: 500 },
    );
  }
}