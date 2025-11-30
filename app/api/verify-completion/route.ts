import { NextRequest, NextResponse } from "next/server";
import { adminDb } from "@/lib/firebaseAdmin";
import crypto from "crypto";

// Reuse same hashing logic as save-booking
function hashPin(pin: string) {
  return crypto.createHash("sha256").update(pin).digest("hex");
}

export async function POST(req: NextRequest) {
  try {
    const { bookingId, pin, providerId } = await req.json();

    if (!bookingId || !pin) {
      return NextResponse.json(
        { error: "bookingId and pin are required" },
        { status: 400 }
      );
    }

    const bookingRef = adminDb.collection("bookings").doc(bookingId);
    const snap = await bookingRef.get();

    if (!snap.exists) {
      return NextResponse.json({ error: "Booking not found" }, { status: 404 });
    }

    const data = snap.data() as any;

    // Optional guard: ensure only the correct provider can verify
    if (providerId && data.providerId && data.providerId !== providerId) {
      return NextResponse.json(
        { error: "You are not allowed to verify this booking" },
        { status: 403 }
      );
    }

    if (!data.completionPinHash) {
      return NextResponse.json(
        { error: "No completion PIN set for this booking" },
        { status: 400 }
      );
    }

    if (data.releaseVerified) {
      return NextResponse.json(
        { error: "Booking already verified as completed" },
        { status: 409 }
      );
    }

    const givenHash = hashPin(pin.trim());
    if (givenHash !== data.completionPinHash) {
      return NextResponse.json({ error: "Invalid PIN" }, { status: 401 });
    }

    // ✅ Mark booking as service-completed & eligible for payout
    await bookingRef.update({
      releaseVerified: true,
      releaseVerifiedAt: Date.now(),
    });

    // NOTE: Payment logic is untouched. This just flips the "funds can now be released" flag.

    return NextResponse.json({ ok: true });
  } catch (err: any) {
    console.error("verify-completion error:", err?.message || err);
    return NextResponse.json(
      { error: err?.message || "Unknown error" },
      { status: 500 }
    );
  }
}