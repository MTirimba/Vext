// /workspaces/Vext/app/api/verify-completion/route.ts
import { NextRequest, NextResponse } from "next/server";
import { adminDb } from "@/lib/firebaseAdmin";
import { requireAuth } from "@/lib/requireAuth";
import { sendServiceCompletedNotification } from "@/lib/whatsappNotifications";
import crypto from "crypto";

// Reuse same hashing logic as save-booking
function hashPin(pin: string) {
  return crypto.createHash("sha256").update(pin).digest("hex");
}

export async function POST(req: NextRequest) {
  try {
    // 🔐 Must be signed in — identity comes from the verified token, not the body.
    // This matters more than it looks: this endpoint is what flips
    // releaseVerified=true, which is what unlocks a provider's withdrawable
    // balance (see lib/providerBalance.ts).
    const auth = await requireAuth(req);
    if (auth instanceof NextResponse) return auth;

    const { bookingId, pin } = await req.json();

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

    // 🔐 Only the provider who owns this booking can verify completion —
    // this check is now unconditional, it can't be skipped by omitting a field.
    if (!data.providerId || auth.uid !== data.providerId) {
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

    // 🟢 Best-effort WhatsApp notification to the client — not yet
    // registered on Infobip (service_completed), will no-op quietly until
    // approved.
    try {
      if (data.clientPhone) {
        await sendServiceCompletedNotification({
          clientPhone: data.clientPhone,
          clientName: data.clientName || "there",
          serviceName: data.serviceName || "",
        });
      }
    } catch (err) {
      console.error("verify-completion: WhatsApp notification failed", err);
    }

    return NextResponse.json({ ok: true });
  } catch (err: any) {
    console.error("verify-completion error:", err?.message || err);
    return NextResponse.json(
      { error: err?.message || "Unknown error" },
      { status: 500 }
    );
  }
}