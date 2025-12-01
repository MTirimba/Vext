// /workspaces/Vext/app/api/reschedule-booking/route.ts
import { NextRequest, NextResponse } from "next/server";
import { adminDb } from "@/lib/firebaseAdmin";

/**
 * ✅ Handles booking rescheduling safely
 * - Checks new slot availability
 * - Releases old slot
 * - Updates booking time/date
 */
export async function POST(req: NextRequest) {
  try {
    const { bookingId, newDate, newTime } = await req.json();

    if (!bookingId || !newDate || !newTime) {
      return NextResponse.json(
        { error: "Missing bookingId, newDate, or newTime" },
        { status: 400 }
      );
    }

    const bookingRef = adminDb.collection("bookings").doc(bookingId);
    const bookingSnap = await bookingRef.get();

    if (!bookingSnap.exists) {
      return NextResponse.json({ error: "Booking not found" }, { status: 404 });
    }

    const booking = bookingSnap.data() as any;
    const slotsRef = adminDb.collection("booked_slots");

    const newSlotKey = `${booking.providerId}_${newDate}_${newTime}`;
    const oldSlotKey = `${booking.providerId}_${booking.date}_${booking.time}`;

    // Check if the new slot is available
    const newSlotSnap = await slotsRef.doc(newSlotKey).get();
    if (newSlotSnap.exists) {
      return NextResponse.json(
        { error: "The selected time slot is already booked" },
        { status: 409 }
      );
    }

    // Transaction: safely release old slot + assign new one
    await adminDb.runTransaction(async (tx) => {
      // Release old slot
      const oldSlotDoc = await tx.get(slotsRef.doc(oldSlotKey));
      if (oldSlotDoc.exists) tx.delete(slotsRef.doc(oldSlotKey));

      // Create new slot
      tx.set(slotsRef.doc(newSlotKey), {
        providerId: booking.providerId,
        date: newDate,
        time: newTime,
        bookingId,
        updatedAt: Date.now(),
      });

      // Update booking record
      tx.update(bookingRef, {
        date: newDate,
        time: newTime,
        status: "pending",
        rescheduledAt: Date.now(),
      });
    });

    return NextResponse.json({
      success: true,
      message: "Booking rescheduled successfully",
      refreshSlots: true,
    });
  } catch (err: any) {
    console.error("reschedule-booking error:", err?.message || err);
    return NextResponse.json(
      { error: err?.message || "Internal server error" },
      { status: 500 }
    );
  }
}