// /workspaces/Vext/lib/confirmBookingCore.ts
import { adminDb } from "@/lib/firebaseAdmin";

export type ConfirmBookingInput = {
  bookingId: string;
  paymentRef?: string;
  method: string;
  previousTime?: string;
  walletPay?: boolean;
  /**
   * For method === "paystack" only. Pass the amount (in KES, i.e. already
   * divided by 100) that a channel with its own independent authority over
   * the figure has confirmed was actually paid:
   *  - the Paystack webhook passes this straight from the signature-verified
   *    webhook payload (no extra API call needed — the signature already
   *    proves Paystack sent it).
   *  - the client-triggered /api/confirm-booking route does NOT have an
   *    independently-verified figure (the browser could lie about it), so it
   *    omits this and confirmBookingCore instead calls Paystack's own
   *    transaction-verify API using `paymentRef` to fetch the authoritative
   *    amount itself.
   * Either way, a client can never talk its way into a confirmed booking by
   * simply claiming payment succeeded — the amount is always checked against
   * a source Paystack (not the browser) controls.
   */
  verifiedPaystackAmount?: number;
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
        alreadyConfirmed?: true;
      };
    }
  | { ok: false; status: number; body: { error: string } };

// Rounding on both the client and Paystack's side (KES <-> kobo/cents
// conversion) can leave a few cents of slack — allow it, but nothing more.
const PAYSTACK_AMOUNT_TOLERANCE_KES = 1;

/**
 * Calls Paystack's own transaction-verify API — the one channel a client
 * cannot spoof — to find out what was actually paid for a given reference.
 * Used when we don't already have an amount from a signature-verified
 * webhook payload.
 */
async function verifyPaystackTransaction(
  reference: string,
): Promise<{ ok: true; amountKes: number; status: string } | { ok: false; error: string }> {
  const secret = process.env.PAYSTACK_SECRET_KEY || "";
  if (!secret) {
    return { ok: false, error: "Paystack secret key is not configured" };
  }

  try {
    const res = await fetch(
      `https://api.paystack.co/transaction/verify/${encodeURIComponent(reference)}`,
      { headers: { Authorization: `Bearer ${secret}` } },
    );
    const json = await res.json().catch(() => null);
    if (!res.ok || !json?.data) {
      return {
        ok: false,
        error: json?.message || "Could not verify transaction with Paystack",
      };
    }
    const amountKes = Number(json.data.amount) / 100;
    return { ok: true, amountKes, status: String(json.data.status || "") };
  } catch (err: any) {
    return {
      ok: false,
      error: err?.message || "Paystack verification request failed",
    };
  }
}

/**
 * Core booking-confirmation logic, extracted so it can be called either:
 *  - from app/api/confirm-booking/route.ts, after verifying the caller's
 *    Firebase auth token and that they own the booking, OR
 *  - directly (no HTTP hop, no user token) from server-side code that has
 *    already independently verified payment — e.g. the Pesapal callback,
 *    which confirms status via a server-to-server call to Pesapal's API
 *    before ever reaching this function, or the Paystack webhook, which
 *    passes the signature-verified amount straight through.
 *
 * IMPORTANT: this function does NOT check booking ownership. Callers that
 * accept a request from an end user (i.e. the API route) MUST check that
 * themselves before calling this.
 */
export async function confirmBookingCore(
  input: ConfirmBookingInput,
): Promise<ConfirmBookingResult> {
  const { bookingId, paymentRef, method, previousTime, walletPay, verifiedPaystackAmount } =
    input;

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

  // 🔐 Idempotency: both the client-side Paystack callback and the Paystack
  // webhook typically fire for the same successful payment. Re-running the
  // logic below a second time would double-write platform_earnings and
  // could double-debit a wallet. If this booking is already confirmed,
  // treat any further confirmation attempt for it as a harmless no-op.
  if (booking.status === "confirmed") {
    return {
      ok: true,
      status: 200,
      body: {
        success: true,
        message: "Booking already confirmed",
        commission: Number(booking.commission) || 0,
        providerAmount: Number(booking.providerAmount) || 0,
        platformFee: Number(booking.platformFee) || 0,
        alreadyConfirmed: true,
      },
    };
  }

  const { providerId, date, time, total, clientId } = booking;

  if (!providerId || !date || !time) {
    return { ok: false, status: 400, body: { error: "Incomplete booking data" } };
  }

  const totalNumber = Number(total);
  if (!Number.isFinite(totalNumber) || totalNumber <= 0) {
    return { ok: false, status: 400, body: { error: "Invalid booking total" } };
  }

  // 🔐 Paystack: never take a client's word that payment succeeded. Find out
  // what was actually paid from a channel Paystack itself controls, and
  // refuse to confirm if it falls short of the booking's authoritative total
  // (which already includes the logistics fee for housecalls).
  if (method === "paystack") {
    let paidAmountKes: number;

    if (typeof verifiedPaystackAmount === "number") {
      // Already verified by the caller via a signature-checked webhook
      // payload — no need to hit Paystack's API again.
      paidAmountKes = verifiedPaystackAmount;
    } else {
      if (!paymentRef) {
        return {
          ok: false,
          status: 400,
          body: { error: "Missing paymentRef for paystack verification" },
        };
      }
      const verification = await verifyPaystackTransaction(paymentRef);
      if (!verification.ok) {
        return {
          ok: false,
          status: 502,
          body: { error: `Could not verify Paystack payment: ${verification.error}` },
        };
      }
      if (verification.status !== "success") {
        return {
          ok: false,
          status: 400,
          body: { error: "Paystack transaction was not successful" },
        };
      }
      paidAmountKes = verification.amountKes;
    }

    if (paidAmountKes < totalNumber - PAYSTACK_AMOUNT_TOLERANCE_KES) {
      return {
        ok: false,
        status: 400,
        body: {
          error: `Amount paid (KSHS ${paidAmountKes}) does not cover the booking total (KSHS ${totalNumber}).`,
        },
      };
    }
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