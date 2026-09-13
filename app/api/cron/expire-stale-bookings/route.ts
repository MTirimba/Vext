// /workspaces/Vext/app/api/cron/expire-stale-bookings/route.ts
//
// Backstop for abandoned payments. BookingModal now calls /api/cancel-booking
// when someone explicitly backs out of the Paystack popup, and M-Pesa's own
// callback marks a failed/cancelled STK push as "payment_failed" — but
// neither covers someone just closing the browser tab entirely mid-payment.
// A booking that never reached "confirmed" never actually happened — it's
// a checkout attempt, not a booking — so this deletes it outright rather
// than leaving any record behind, same as cancel-booking/reject-booking do
// for the "pending"/"payment_failed" case.
//
// Runs against both "pending" (still mid-checkout, abandoned) and
// "payment_failed" (M-Pesa declined/cancelled) — neither should linger
// forever, and neither was ever a real booking.
//
// Call this on a schedule (see the Vercel Cron example in
// app/api/cron/booking-reminders/route.ts for the config shape) — every
// 15–30 minutes is reasonable. Protected the same way: `CRON_SECRET` via
// `Authorization: Bearer <secret>` or `?secret=<secret>`.
import { NextRequest, NextResponse } from "next/server";
import { adminDb } from "@/lib/firebaseAdmin";

// No realistic payment flow (M-Pesa STK, Paystack checkout) takes anywhere
// near this long — anything still stuck here was abandoned.
const STALE_AFTER_MS = 30 * 60 * 1000; // 30 minutes

function isAuthorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;

  const authHeader = req.headers.get("authorization");
  if (authHeader === `Bearer ${secret}`) return true;

  return req.nextUrl.searchParams.get("secret") === secret;
}

async function expireStatus(status: string, cutoff: number): Promise<number> {
  const snap = await adminDb
    .collection("bookings")
    .where("status", "==", status)
    .where("createdAt", "<=", cutoff)
    .get();

  let expired = 0;

  for (const bookingDoc of snap.docs) {
    try {
      await bookingDoc.ref.delete();
      expired++;
    } catch (err) {
      console.error(`expire-stale-bookings: failed for ${bookingDoc.id}`, err);
    }
  }

  return expired;
}

export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const cutoff = Date.now() - STALE_AFTER_MS;

  const [expiredPending, expiredFailed] = await Promise.all([
    expireStatus("pending", cutoff),
    expireStatus("payment_failed", cutoff),
  ]);

  return NextResponse.json({
    ok: true,
    expired: expiredPending + expiredFailed,
    expiredPending,
    expiredFailed,
  });
}