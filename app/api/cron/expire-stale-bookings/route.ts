// /workspaces/Vext/app/api/cron/expire-stale-bookings/route.ts
//
// Backstop for abandoned payments. BookingModal now calls /api/cancel-booking
// when someone explicitly backs out of the Paystack popup, and M-Pesa's own
// callback marks a failed/cancelled STK push as "payment_failed" — but
// neither covers someone just closing the browser tab entirely mid-payment,
// which leaves a booking sitting in "pending" forever, indistinguishable
// from a real upcoming booking on the bookings page.
//
// Call this on a schedule (see the Vercel Cron example in
// app/api/cron/booking-reminders/route.ts for the config shape) — every
// 15–30 minutes is reasonable. Protected the same way: `CRON_SECRET` via
// `Authorization: Bearer <secret>` or `?secret=<secret>`.
import { NextRequest, NextResponse } from "next/server";
import { adminDb } from "@/lib/firebaseAdmin";

// Anything still "pending" longer than this was abandoned — no realistic
// payment flow (M-Pesa STK, Paystack checkout) takes anywhere near this long.
const STALE_AFTER_MS = 30 * 60 * 1000; // 30 minutes

function isAuthorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;

  const authHeader = req.headers.get("authorization");
  if (authHeader === `Bearer ${secret}`) return true;

  return req.nextUrl.searchParams.get("secret") === secret;
}

export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const cutoff = Date.now() - STALE_AFTER_MS;

  const snap = await adminDb
    .collection("bookings")
    .where("status", "==", "pending")
    .where("createdAt", "<=", cutoff)
    .get();

  let expired = 0;

  for (const bookingDoc of snap.docs) {
    const booking = bookingDoc.data() as any;
    try {
      // No payment was ever confirmed for a "pending" booking, so there's
      // nothing to refund — this mirrors cancel-booking's own logic for
      // the pending case, just triggered by staleness instead of a person
      // clicking cancel.
      await bookingDoc.ref.update({
        status: "cancelled",
        cancelledAt: Date.now(),
        cancelledBy: "system",
        cancelledReason: "Payment abandoned — no confirmation within 30 minutes",
      });

      if (booking.providerId && booking.date && booking.time) {
        const slotKey = `${booking.providerId}_${booking.date}_${booking.time}`;
        const slotRef = adminDb.collection("booked_slots").doc(slotKey);
        const slotSnap = await slotRef.get();
        if (slotSnap.exists) await slotRef.delete();
      }

      expired++;
    } catch (err) {
      console.error(`expire-stale-bookings: failed for ${bookingDoc.id}`, err);
    }
  }

  return NextResponse.json({ ok: true, expired, checked: snap.size });
}