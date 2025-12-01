// /app/api/pesapal/payout-callback/route.ts
import { NextResponse } from "next/server";
import { adminDb } from "@/lib/firebaseAdmin";

/**
 * Pesapal calls this endpoint automatically when a payout changes status.
 * It updates the provider's Firestore withdrawal document accordingly.
 */
export async function POST(req: Request) {
  try {
    const body = await req.json();
    console.log("📩 Pesapal Payout Webhook Received:", body);

    const {
      order_tracking_id,
      status_code,
      status_description,
      recipient_phone_number,
      amount,
      narrative,
    } = body;

    if (!order_tracking_id) {
      return NextResponse.json(
        { error: "Missing order_tracking_id" },
        { status: 400 }
      );
    }

    // ✅ Find matching withdrawal in Firestore
    const usersSnap = await adminDb.collection("users").get();

    let matchFound = false;

    for (const userDoc of usersSnap.docs) {
      const withdrawalsRef = userDoc.ref.collection("withdrawals");
      const withdrawalSnap = await withdrawalsRef
        .where("pesapal_ref", "==", order_tracking_id)
        .limit(1)
        .get();

      if (!withdrawalSnap.empty) {
        const withdrawalDoc = withdrawalSnap.docs[0].ref;

        const newStatus =
          status_description?.toLowerCase().includes("completed")
            ? "completed"
            : status_description?.toLowerCase().includes("failed")
            ? "failed"
            : "processing";

        await withdrawalDoc.update({
          status: newStatus,
          status_description: status_description || "",
          updated_at: new Date().toISOString(),
        });

        console.log(`✅ Withdrawal ${order_tracking_id} updated to: ${newStatus}`);
        matchFound = true;
        break;
      }
    }

    if (!matchFound) {
      console.warn("⚠️ No matching withdrawal found for:", order_tracking_id);
    }

    return NextResponse.json({
      message: "Pesapal payout callback processed successfully",
      order_tracking_id,
      status: status_description,
    });
  } catch (err: any) {
    console.error("🔥 Pesapal payout webhook error:", err);
    return NextResponse.json(
      { error: err.message || "Payout callback failed" },
      { status: 500 }
    );
  }
}
