// /workspaces/Vext/lib/confirmBookingCore.ts
import { adminDb } from "@/lib/firebaseAdmin";

export type ConfirmBookingInput = {
  bookingId: string;
  paymentRef?: string;
  method: string;
  previousTime?: string;
  walletPay?: boolean;
};

export type ConfirmBookingResult =
  | {
      ok: true;
      status: 200;
      body: {
        success: true;
        message: string;
        commission: number;
        providerAmount: number;
        platformFee: number;
        walletTxId?: string;
      };
    }
  | { ok: false; status: number; body: { error: string } };

/**
 * Core booking-confirmation logic, extracted so it can be called either:
 *  - from app/api/confirm-booking/route.ts, after verifying the caller's
 *    Firebase auth token and that they own the booking, OR
 *  - directly (no HTTP hop, no user token) from server-side code that has
 *    already independently verified payment — e.g. the Pesapal callback,
 *    which confirms status via a server-to-server call to Pesapal's API
 *    before ever reaching this function.
 *
 * IMPORTANT: this function does NOT check booking ownership. Callers that
 * accept a request from an end user (i.e. the API route) MUST check that
 * themselves before calling this.
 */
export async function confirmBookingCore(
  input: ConfirmBookingInput,
): Promise<ConfirmBookingResult> {
  const { bookingId, paymentRef, method, previousTime, walletPay } = input;

  if (!bookingId || !method) {
    return { ok: false, status: 400, body: { error: "Missing bookingId or method" } };
  }

  if (method !== "wallet" && !paymentRef) {
    return {
      ok: false,
      status: 400,
      body: { error: "Missing paymentRef for non-wallet payment method" },
    };
  }

  const bookingRef = adminDb.collection("bookings").doc(bookingId);
  const bookingSnap = await bookingRef.get();

  if (!bookingSnap.exists) {
    return { ok: false, status: 404, body: { error: "Booking not found" } };
  }

  const booking = bookingSnap.data() as any;
  const { providerId, date, time, total, clientId } = booking;

  if (!providerId || !date || !time) {
    return { ok: false, status: 400, body: { error: "Incomplete booking data" } };
  }

  const totalNumber = Number(total);
  if (!Number.isFinite(totalNumber) || totalNumber <= 0) {
    return { ok: false, status: 400, body: { error: "Invalid booking total" } };
  }

  // 🚫 Prevent double confirmation for the same provider/date/time
  const overlapSnap = await adminDb
    .collection("bookings")
    .where("providerId", "==", providerId)
    .where("date", "==", date)
    .where("time", "==", time)
    .where("status", "==", "confirmed")
    .get();

  if (!overlapSnap.empty && overlapSnap.docs[0].id !== bookingId) {
    return {
      ok: false,
      status: 409,
      body: { error: "Time slot already confirmed by another booking" },
    };
  }

  // ---------- 💰 Compute platform fee & provider amount ----------
  const baseSubtotal = Number(
    booking.subtotal ??
      booking.baseTotal ??
      booking.subtotalBeforeMarkup ??
      booking.basePrice,
  );

  let platformFee = Number(
    booking.platformFee ?? booking.markupAmount ?? booking.markupFee,
  );

  if (!Number.isFinite(platformFee) || platformFee < 0) {
    if (
      Number.isFinite(baseSubtotal) &&
      baseSubtotal > 0 &&
      totalNumber > baseSubtotal
    ) {
      platformFee = +(totalNumber - baseSubtotal).toFixed(2);
    } else if (typeof booking.markupRate === "number" && booking.markupRate > 0) {
      const rate =
        booking.markupRate > 1.5 ? booking.markupRate / 100 : booking.markupRate;
      const fee = totalNumber * (rate / (1 + rate));
      platformFee = +fee.toFixed(2);
    } else if (Number.isFinite(baseSubtotal) && baseSubtotal > 0) {
      platformFee = +(totalNumber - baseSubtotal).toFixed(2);
    } else {
      const fee = totalNumber * 0.1;
      platformFee = +fee.toFixed(2);
    }
  }

  if (!Number.isFinite(platformFee) || platformFee < 0) {
    platformFee = 0;
  }

  let providerAmount = +(totalNumber - platformFee).toFixed(2);
  if (providerAmount < 0) providerAmount = 0;

  const commission = platformFee;

  // ---------- 💰 Wallet flow (optional) ----------
  let effectivePaymentRef: string | undefined = paymentRef;
  let walletTxId: string | undefined;

  if (method === "wallet" || walletPay) {
    if (!clientId) {
      return {
        ok: false,
        status: 400,
        body: { error: "Missing clientId for wallet payment" },
      };
    }

    const walletTxCol = adminDb
      .collection("users")
      .doc(clientId)
      .collection("walletTransactions");

    const walletSnap = await walletTxCol.get();
    let balance = 0;
    walletSnap.forEach((d) => {
      const data = d.data() as any;
      const status = (data.status || "").toLowerCase();
      if (status !== "completed") return;
      const amt = Number(data.amount) || 0;
      const type = (data.type || "credit") as "credit" | "debit";
      balance += type === "credit" ? amt : -amt;
    });

    if (balance < totalNumber) {
      return {
        ok: false,
        status: 400,
        body: {
          error:
            "Insufficient wallet balance to pay for this booking. Please deposit more or use another method.",
        },
      };
    }

    const debitDoc = await walletTxCol.add({
      amount: totalNumber,
      type: "debit",
      reason: "booking_payment",
      bookingId,
      status: "completed",
      createdAt: Date.now(),
      method: "wallet",
    });

    walletTxId = debitDoc.id;

    if (!effectivePaymentRef) {
      effectivePaymentRef = `wallet:${walletTxId}`;
    }
  }

  await bookingRef.update({
    status: "confirmed",
    paymentRef: effectivePaymentRef ?? null,
    method,
    confirmedAt: Date.now(),
    commission,
    providerAmount,
    platformFee,
  });

  await adminDb.collection("platform_earnings").add({
    bookingId,
    providerId,
    commission,
    platformFee,
    total: totalNumber,
    providerAmount,
    method,
    createdAt: Date.now(),
  });

  const slotsRef = adminDb.collection("booked_slots");
  const newSlotKey = `${providerId}_${date}_${time}`;

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

  return {
    ok: true,
    status: 200,
    body: {
      success: true,
      message: "Booking confirmed successfully",
      commission,
      providerAmount,
      platformFee,
      ...(walletTxId ? { walletTxId } : {}),
    },
  };
}