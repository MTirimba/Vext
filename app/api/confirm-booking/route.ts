import { NextRequest, NextResponse } from "next/server";
import { adminDb } from "@/lib/firebaseAdmin";

/**
 * ✅ Confirm booking after successful payment (Paystack / M-Pesa / Pesapal)
 * Retains 10% platform commission and updates booked slots.
 */
export async function POST(req: NextRequest) {
  try {
    const { bookingId, paymentRef, method, previousTime } = await req.json();

    if (!bookingId || !paymentRef || !method) {
      return NextResponse.json(
        { error: "Missing bookingId, paymentRef, or method" },
        { status: 400 }
      );
    }

    const bookingRef = adminDb.collection("bookings").doc(bookingId);
    const bookingSnap = await bookingRef.get();

    if (!bookingSnap.exists) {
      return NextResponse.json({ error: "Booking not found" }, { status: 404 });
    }

    const booking = bookingSnap.data() as any;
    const { providerId, date, time, total } = booking;

    if (!providerId || !date || !time) {
      return NextResponse.json({ error: "Incomplete booking data" }, { status: 400 });
    }

    // 🚫 Prevent double confirmation
    const overlapSnap = await adminDb
      .collection("bookings")
      .where("providerId", "==", providerId)
      .where("date", "==", date)
      .where("time", "==", time)
      .where("status", "==", "confirmed")
      .get();

    if (!overlapSnap.empty && overlapSnap.docs[0].id !== bookingId) {
      return NextResponse.json(
        { error: "Time slot already confirmed by another booking" },
        { status: 409 }
      );
    }

    if (!total || total <= 0)
      return NextResponse.json({ error: "Invalid booking total" }, { status: 400 });

    // 💰 Compute commission
    const commission = +(total * 0.1).toFixed(2);
    const providerAmount = +(total - commission).toFixed(2);

    // ✅ Update booking
    await bookingRef.update({
      status: "confirmed",
      paymentRef,
      method,
      confirmedAt: Date.now(),
      commission,
      providerAmount,
    });

    // 🔔 Log platform earnings
    await adminDb.collection("platform_earnings").add({
      bookingId,
      providerId,
      commission,
      method,
      createdAt: Date.now(),
    });

    // ✅ Maintain booked_slots
    const slotsRef = adminDb.collection("booked_slots");
    const newSlotKey = `${providerId}_${date}_${time}`;

    // Remove old slot if rescheduled
    if (previousTime && previousTime !== time) {
      const oldSlotKey = `${providerId}_${date}_${previousTime}`;
      const oldDoc = await slotsRef.doc(oldSlotKey).get();
      if (oldDoc.exists) await slotsRef.doc(oldSlotKey).delete();
    }

    await slotsRef.doc(newSlotKey).set({
      providerId,
      date,
      time,
      bookingId,
      confirmedAt: Date.now(),
    });

    return NextResponse.json({
      success: true,
      message: "Booking confirmed successfully",
      commission,
      providerAmount,
    });
  } catch (err: any) {
    console.error("confirm-booking error:", err?.message || err);
    return NextResponse.json(
      { error: err?.message || "Internal server error" },
      { status: 500 }
    );
  }
}