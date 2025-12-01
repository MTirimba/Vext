// /app/api/cancel-booking/route.ts
import { NextRequest, NextResponse } from "next/server";
import { adminDb } from "@/lib/firebaseAdmin";

/**
 * Client cancels a booking.
 * - Marks booking as "cancelled"
 * - Frees booked slot in booked_slots
 * - Credits client's wallet if the booking was already paid
 */
export async function POST(req: NextRequest) {
  try {
    const { bookingId, clientId: callerClientId, reason } = await req.json();

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

    // Basic auth safety: if caller sent clientId, it must match
    if (callerClientId && callerClientId !== clientId) {
      return NextResponse.json(
        { error: "You are not allowed to cancel this booking" },
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
    let walletTxId: string | null = null;
    if (total > 0 && status !== "pending") {
      const walletRef = await adminDb
        .collection("users")
        .doc(clientId)
        .collection("walletTransactions")
        .add({
          amount: total,
          type: "credit",
          reason: "client_cancelled_booking",
          bookingId,
          createdAt: Date.now(),
          status: "completed",
        });

      walletTxId = walletRef.id;
    }

    await bookingRef.update({
      status: "cancelled",
      cancelledAt: Date.now(),
      cancelledBy: "client",
      cancelledReason: reason || null,
      refundedAt: walletTxId ? Date.now() : null,
      refundWalletTxId: walletTxId || null,
    });

    // 🔔 Notifications
    const shortId = booking.shortId || bookingId;
    const baseNotif = {
      type: "booking-status-change",
      bookingId,
      shortId,
      status: "cancelled",
      createdAt: Date.now(),
      read: false,
    };

    // notify client for confirmation / record
    await adminDb
      .collection("users")
      .doc(clientId)
      .collection("notifications")
      .add({
        ...baseNotif,
        userRole: "client",
        title: "Booking cancelled",
        message: `You cancelled booking #${shortId}. Any paid amount was moved to your wallet.`,
      });

    // notify provider
    await adminDb
      .collection("users")
      .doc(providerId)
      .collection("notifications")
      .add({
        ...baseNotif,
        userRole: "provider",
        title: "Client cancelled booking",
        message: `Client cancelled booking #${shortId}.`,
      });

    return NextResponse.json({
      success: true,
      bookingId,
      refunded: !!walletTxId,
      refundWalletTxId: walletTxId,
    });
  } catch (err: any) {
    console.error("cancel-booking error:", err?.message || err);
    return NextResponse.json(
      { error: err?.message || "Internal server error" },
      { status: 500 },
    );
  }
}