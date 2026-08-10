// /app/api/reject-booking/route.ts
import { NextRequest, NextResponse } from "next/server";
import { adminDb } from "@/lib/firebaseAdmin";
import { requireAuth } from "@/lib/requireAuth";

/**
 * Provider rejects a booking.
 * - Marks booking as "rejected"
 * - Frees booked slot in booked_slots
 * - Credits client's wallet if the booking was already paid (confirmed/accepted/completed)
 * - (Optional) You can hook notification sending here too
 */
export async function POST(req: NextRequest) {
  try {
    // 🔐 Must be signed in — identity comes from the verified token, not the body
    const auth = await requireAuth(req);
    if (auth instanceof NextResponse) return auth;

    const { bookingId, reason } = await req.json();

    if (!bookingId) {
      return NextResponse.json(
        { error: "Missing bookingId" },
        { status: 400 },
      );
    }

    const bookingRef = adminDb.collection("bookings").doc(bookingId);
    const bookingSnap = await bookingRef.get();

    if (!bookingSnap.exists) {
      return NextResponse.json(
        { error: "Booking not found" },
        { status: 404 },
      );
    }

    const booking = bookingSnap.data() as any;
    const providerId = booking.providerId as string | undefined;
    const clientId = booking.clientId as string | undefined;

    if (!providerId || !clientId) {
      return NextResponse.json(
        { error: "Booking missing providerId or clientId" },
        { status: 400 },
      );
    }

    // 🔐 Only the provider who owns this booking may reject it
    if (auth.uid !== providerId) {
      return NextResponse.json(
        { error: "You are not allowed to reject this booking" },
        { status: 403 },
      );
    }

    const status = (booking.status || "").toLowerCase();
    const total = Number(booking.total) || 0;

    // Free booked slot (if it exists)
    if (booking.date && booking.time) {
      const slotKey = `${providerId}_${booking.date}_${booking.time}`;
      const slotRef = adminDb.collection("booked_slots").doc(slotKey);
      const slotSnap = await slotRef.get();
      if (slotSnap.exists) {
        await slotRef.delete();
      }
    }

    // Only refund wallet if the booking was already paid
    // i.e. not just a soft "pending" hold
    let walletTxId: string | null = null;
    if (total > 0 && status !== "pending") {
      const walletRef = await adminDb
        .collection("users")
        .doc(clientId)
        .collection("walletTransactions")
        .add({
          amount: total,
          type: "credit",
          reason: "provider_rejected_booking",
          bookingId,
          createdAt: Date.now(),
          status: "completed",
        });

      walletTxId = walletRef.id;
    }

    // Update booking document
    await bookingRef.update({
      status: "rejected",
      rejectedAt: Date.now(),
      rejectedReason: reason || null,
      refundedAt: walletTxId ? Date.now() : null,
      refundWalletTxId: walletTxId || null,
      cancelledBy: "provider",
    });

    // 🔔 Optional: create notifications in users/{uid}/notifications
    const shortId = booking.shortId || bookingId;
    const baseNotif = {
      type: "booking-status-change",
      bookingId,
      shortId,
      status: "rejected",
      createdAt: Date.now(),
      read: false,
    };

    // notify client
    await adminDb
      .collection("users")
      .doc(clientId)
      .collection("notifications")
      .add({
        ...baseNotif,
        userRole: "client",
        title: "Booking rejected",
        message: `Your booking #${shortId} was rejected by the provider.`,
      });

    // notify provider (for their history)
    await adminDb
      .collection("users")
      .doc(providerId)
      .collection("notifications")
      .add({
        ...baseNotif,
        userRole: "provider",
        title: "Booking marked as rejected",
        message: `You rejected booking #${shortId}.`,
      });

    return NextResponse.json({
      success: true,
      bookingId,
      refunded: !!walletTxId,
      refundWalletTxId: walletTxId,
    });
  } catch (err: any) {
    console.error("reject-booking error:", err?.message || err);
    return NextResponse.json(
      { error: err?.message || "Internal server error" },
      { status: 500 },
    );
  }
}