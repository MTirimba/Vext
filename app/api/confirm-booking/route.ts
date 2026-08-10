import { NextRequest, NextResponse } from "next/server";
import { adminDb } from "@/lib/firebaseAdmin";
import { requireAuth } from "@/lib/requireAuth";
import { confirmBookingCore } from "@/lib/confirmBookingCore";

/**
 * ✅ Confirm booking after successful payment (Paystack / M-Pesa / Wallet)
 * initiated directly by the signed-in client.
 *
 * NOTE: the Pesapal callback route confirms bookings itself, by calling
 * confirmBookingCore() directly (server-to-server, after verifying payment
 * status with Pesapal) — it does not come through this HTTP route, since it
 * has no end-user auth token to present.
 */
export async function POST(req: NextRequest) {
  try {
    // 🔐 Must be signed in — identity comes from the verified token
    const auth = await requireAuth(req);
    if (auth instanceof NextResponse) return auth;

    const { bookingId, paymentRef, method, previousTime, walletPay } =
      await req.json();

    if (!bookingId) {
      return NextResponse.json(
        { error: "Missing bookingId" },
        { status: 400 },
      );
    }

    const bookingSnap = await adminDb.collection("bookings").doc(bookingId).get();
    if (!bookingSnap.exists) {
      return NextResponse.json(
        { error: "Booking not found" },
        { status: 404 },
      );
    }

    const booking = bookingSnap.data() as any;

    // 🔐 Only the client who owns this booking can confirm/pay for it —
    // this is what stops a stranger from re-triggering a wallet debit
    // against someone else's booking.
    if (!booking.clientId || auth.uid !== booking.clientId) {
      return NextResponse.json(
        { error: "You are not allowed to confirm this booking" },
        { status: 403 },
      );
    }

    const result = await confirmBookingCore({
      bookingId,
      paymentRef,
      method,
      previousTime,
      walletPay,
    });

    return NextResponse.json(result.body, { status: result.status });
  } catch (err: any) {
    console.error("confirm-booking error:", err?.message || err);
    return NextResponse.json(
      { error: err?.message || "Internal server error" },
      { status: 500 },
    );
  }
}