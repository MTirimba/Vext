import { NextRequest, NextResponse } from "next/server";
import { adminDb } from "@/lib/firebaseAdmin";
import { createUserNotification } from "@/lib/serverNotifications";

/**
 * Creates an in-app notification for the provider when:
 *  - a client reschedules a booking
 *  - a client cancels a booking
 *
 * POST body:
 *  {
 *    bookingId: string;
 *    changeType: "rescheduled" | "canceled";
 *  }
 */
export async function POST(req: NextRequest) {
  try {
    const { bookingId, changeType } = await req.json();

    if (!bookingId || !changeType) {
      return NextResponse.json(
        { error: "Missing bookingId or changeType" },
        { status: 400 }
      );
    }

    if (changeType !== "rescheduled" && changeType !== "canceled") {
      return NextResponse.json(
        { error: "Invalid changeType" },
        { status: 400 }
      );
    }

    const bookingRef = adminDb.collection("bookings").doc(bookingId);
    const snap = await bookingRef.get();

    if (!snap.exists) {
      return NextResponse.json(
        { error: "Booking not found" },
        { status: 404 }
      );
    }

    const booking = snap.data() as any;
    const {
      providerId,
      clientName,
      shortId,
      date,
      time,
    } = booking;

    if (!providerId) {
      return NextResponse.json(
        { error: "Booking has no providerId" },
        { status: 400 }
      );
    }

    const bookingLabel = shortId || bookingId;
    const name = clientName || "A client";
    const dateStr = date ? new Date(date).toDateString() : "";
    const timeStr = time || "";

    let message: string;

    if (changeType === "rescheduled") {
      message =
        `${name} rescheduled booking #${bookingLabel}` +
        (dateStr || timeStr
          ? ` to ${[dateStr, timeStr].filter(Boolean).join(" at ")}.`
          : ".");
    } else {
      // canceled
      message =
        `${name} canceled booking #${bookingLabel}` +
        (dateStr || timeStr
          ? ` that was scheduled on ${[dateStr, timeStr]
              .filter(Boolean)
              .join(" at ")}.`
          : ".");
    }

    await createUserNotification(providerId, {
      type: "generic",
      role: "provider",
      bookingId,
      bookingStatus: changeType, // "rescheduled" | "canceled"
      message,
    });

    return NextResponse.json({ success: true }, { status: 200 });
  } catch (err: any) {
    console.error("booking-change-notification error:", err?.message || err);
    return NextResponse.json(
      { error: err?.message || "Internal server error" },
      { status: 500 }
    );
  }
}