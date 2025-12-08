import { NextRequest, NextResponse } from "next/server";
import { adminDb } from "@/lib/firebaseAdmin";

/**
 * ✅ Confirm booking after successful payment (Paystack / M-Pesa / Pesapal / Wallet)
 * Uses stored markup/platform fee when available and updates booked slots.
 */
export async function POST(req: NextRequest) {
  try {
    const { bookingId, paymentRef, method, previousTime, walletPay } =
      await req.json();

    // Basic validation: booking + method required
    if (!bookingId || !method) {
      return NextResponse.json(
        { error: "Missing bookingId or method" },
        { status: 400 },
      );
    }

    // For external methods, a paymentRef is mandatory
    if (method !== "wallet" && !paymentRef) {
      return NextResponse.json(
        { error: "Missing paymentRef for non-wallet payment method" },
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
    const { providerId, date, time, total, clientId } = booking;

    if (!providerId || !date || !time) {
      return NextResponse.json(
        { error: "Incomplete booking data" },
        { status: 400 },
      );
    }

    const totalNumber = Number(total);
    if (!Number.isFinite(totalNumber) || totalNumber <= 0) {
      return NextResponse.json(
        { error: "Invalid booking total" },
        { status: 400 },
      );
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
      return NextResponse.json(
        { error: "Time slot already confirmed by another booking" },
        { status: 409 },
      );
    }

    // ---------- 💰 Compute platform fee & provider amount ----------
    // Prefer explicit fields from saving/checkout step, then fall back gracefully.

    // Base/subtotal the provider should receive (before markup)
    const baseSubtotal = Number(
      booking.subtotal ??
        booking.baseTotal ??
        booking.subtotalBeforeMarkup ??
        booking.basePrice,
    );

    // Try direct platform fee fields first
    let platformFee = Number(
      booking.platformFee ?? booking.markupAmount ?? booking.markupFee,
    );

    // If platform fee isn't explicitly stored, try to derive it
    if (!Number.isFinite(platformFee) || platformFee < 0) {
      // If we know the provider base and client total, difference is the fee
      if (
        Number.isFinite(baseSubtotal) &&
        baseSubtotal > 0 &&
        totalNumber > baseSubtotal
      ) {
        platformFee = +(totalNumber - baseSubtotal).toFixed(2);
      } else if (
        typeof booking.markupRate === "number" &&
        booking.markupRate > 0
      ) {
        // markupRate may be stored as fraction (0.1) or percent (10)
        const rate =
          booking.markupRate > 1.5 ? booking.markupRate / 100 : booking.markupRate;
        // total = base * (1 + rate) → fee = base * rate = total * rate / (1 + rate)
        const fee = totalNumber * (rate / (1 + rate));
        platformFee = +fee.toFixed(2);
      } else if (Number.isFinite(baseSubtotal) && baseSubtotal > 0) {
        // If baseSubtotal is valid, treat it as provider's share
        platformFee = +(totalNumber - baseSubtotal).toFixed(2);
      } else {
        // Legacy fallback: assume flat 10% markup if we know nothing else
        const fee = totalNumber * 0.1;
        platformFee = +fee.toFixed(2);
      }
    }

    if (!Number.isFinite(platformFee) || platformFee < 0) {
      platformFee = 0;
    }

    let providerAmount = +(totalNumber - platformFee).toFixed(2);
    if (providerAmount < 0) providerAmount = 0;

    // Keep existing "commission" field name for backwards compatibility
    const commission = platformFee;

    // ---------- 💰 Wallet flow (optional) ----------
    let effectivePaymentRef: string | undefined = paymentRef;
    let walletTxId: string | undefined;

    if (method === "wallet" || walletPay) {
      if (!clientId) {
        return NextResponse.json(
          { error: "Missing clientId for wallet payment" },
          { status: 400 },
        );
      }

      const walletTxCol = adminDb
        .collection("users")
        .doc(clientId)
        .collection("walletTransactions");

      // Compute wallet balance using completed transactions (same logic as client-side)
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
        return NextResponse.json(
          {
            error:
              "Insufficient wallet balance to pay for this booking. Please deposit more or use another method.",
          },
          { status: 400 },
        );
      }

      // Create wallet debit transaction
      const debitDoc = await walletTxCol.add({
        amount: totalNumber,
        type: "debit",
        reason: "booking_payment",
        bookingId,
        status: "completed",
        createdAt: Date.now(), // wallet page already handles Date/number/Timestamp
        method: "wallet",
      });

      walletTxId = debitDoc.id;

      // Use a synthetic paymentRef if none was provided
      if (!effectivePaymentRef) {
        effectivePaymentRef = `wallet:${walletTxId}`;
      }
    }

    // ✅ Update booking with payment + pricing breakdown
    await bookingRef.update({
      status: "confirmed",
      paymentRef: effectivePaymentRef ?? null,
      method,
      confirmedAt: Date.now(),
      commission, // legacy
      providerAmount,
      platformFee,
    });

    // 🔔 Log platform earnings
    await adminDb.collection("platform_earnings").add({
      bookingId,
      providerId,
      commission, // legacy name
      platformFee,
      total: totalNumber,
      providerAmount,
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

    const responseBody: any = {
      success: true,
      message: "Booking confirmed successfully",
      commission,
      providerAmount,
      platformFee,
    };

    if (walletTxId) {
      responseBody.walletTxId = walletTxId;
    }

    return NextResponse.json(responseBody);
  } catch (err: any) {
    console.error("confirm-booking error:", err?.message || err);
    return NextResponse.json(
      { error: err?.message || "Internal server error" },
      { status: 500 },
    );
  }
}