// /workspaces/Vext/app/api/cron/booking-reminders/route.ts
//
// Nothing else in the app triggers on a time delay — every other
// notification fires off a real event (booking created, confirmed,
// rejected, etc.). This route needs an external scheduler to actually run:
//
//   - Vercel Cron: add to vercel.json —
//       { "crons": [{ "path": "/api/cron/booking-reminders", "schedule": "0 9 * * *" }] }
//     (runs daily at 09:00 UTC; adjust for your audience's timezone)
//   - Or any external scheduler (cron-job.org, GitHub Actions scheduled
//     workflow, etc.) hitting this URL once a day with the secret below.
//
// Protected by CRON_SECRET so randoms can't trigger it — pass it either as
// `Authorization: Bearer <CRON_SECRET>` or `?secret=<CRON_SECRET>`.
import { NextRequest, NextResponse } from "next/server";
import { adminDb } from "@/lib/firebaseAdmin";
import {
  sendBookingReminderClientNotification,
  sendBookingReminderProviderNotification,
} from "@/lib/whatsappNotifications";

function isAuthorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false; // fail closed if not configured

  const authHeader = req.headers.get("authorization");
  if (authHeader === `Bearer ${secret}`) return true;

  const querySecret = req.nextUrl.searchParams.get("secret");
  return querySecret === secret;
}

// "Tomorrow" in the same YYYY-MM-DD shape bookings store their date in.
function tomorrowISO(): string {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const targetDate = tomorrowISO();

  const snap = await adminDb
    .collection("bookings")
    .where("status", "==", "confirmed")
    .where("date", "==", targetDate)
    .get();

  let sent = 0;
  let skipped = 0;

  for (const doc of snap.docs) {
    const booking = doc.data() as any;

    // Idempotency — don't re-send if this cron run (or a retry) already
    // covered this booking today.
    if (booking.reminderSentAt) {
      skipped++;
      continue;
    }

    try {
      if (booking.clientPhone) {
        await sendBookingReminderClientNotification({
          clientPhone: booking.clientPhone,
          clientName: booking.clientName || "there",
          providerName: booking.creatorName || "your provider",
          serviceName: booking.serviceName || "",
          date: booking.date,
          time: booking.time,
          bookingId: doc.id,
        });
      }
      if (booking.providerPhone) {
        await sendBookingReminderProviderNotification({
          providerPhone: booking.providerPhone,
          providerName: booking.creatorName || "there",
          clientName: booking.clientName || "A client",
          serviceName: booking.serviceName || "",
          date: booking.date,
          time: booking.time,
          bookingId: doc.id,
        });
      }

      await doc.ref.update({ reminderSentAt: Date.now() });
      sent++;
    } catch (err) {
      console.error(`booking-reminders: failed for booking ${doc.id}`, err);
    }
  }

  return NextResponse.json({ ok: true, targetDate, sent, skipped, total: snap.size });
}