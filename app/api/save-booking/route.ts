import { NextRequest, NextResponse } from "next/server";
import { adminDb } from "@/lib/firebaseAdmin";
import crypto from "crypto";

// helper: generate short code like "42AB"
function generateShortId() {
  const letters = "ABCDEFGHJKLMNPQRSTUVWXYZ"; // no confusing chars
  const digits = "0123456789";
  let result = "";

  // first two: digits
  for (let i = 0; i < 2; i++) {
    result += digits.charAt(Math.floor(Math.random() * digits.length));
  }

  // last two: letters or digits
  const mixed = letters + digits;
  for (let i = 0; i < 2; i++) {
    result += mixed.charAt(Math.floor(Math.random() * mixed.length));
  }

  return result;
}

// 🔐 numeric release PIN used to confirm service completion
function generateReleasePin(length = 4) {
  const digits = "0123456789";
  let result = "";
  for (let i = 0; i < length; i++) {
    result += digits.charAt(Math.floor(Math.random() * digits.length));
  }
  return result;
}

function hashPin(pin: string) {
  return crypto.createHash("sha256").update(pin).digest("hex");
}

function normalizeNumbersFromBody(body: any) {
  const rawTotal = Number(body.total || 0);
  const rawSubtotal =
    typeof body.subtotal === "number" ? body.subtotal : undefined;
  const rawMarkupRate =
    typeof body.markupRate === "number" ? body.markupRate : undefined;
  const rawMarkupPercent =
    typeof body.markupPercent === "number" ? body.markupPercent : undefined;
  const rawMarkupAmount =
    typeof body.markupAmount === "number" ? body.markupAmount : undefined;

  const subtotal = rawSubtotal && rawSubtotal > 0 ? rawSubtotal : rawTotal;

  let markupAmount = rawMarkupAmount;
  if (markupAmount == null && subtotal && rawTotal) {
    markupAmount = rawTotal - subtotal;
  }

  let markupRate = rawMarkupRate;
  if (markupRate == null && subtotal && markupAmount != null) {
    markupRate = subtotal > 0 ? markupAmount / subtotal : 0;
  }

  let markupPercent = rawMarkupPercent;
  if (markupPercent == null && typeof markupRate === "number") {
    markupPercent = markupRate * 100;
  }

  return {
    total: rawTotal,
    subtotal,
    markupAmount,
    markupRate,
    markupPercent,
  };
}

/**
 * ✅ Handles both new and updated bookings.
 * - If bookingId is passed, update existing booking.
 * - If not, create a new booking.
 * - Automatically frees old slot if time changed.
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const {
      bookingId,
      clientId,
      providerId,
      videoId,
      date,
      time,
      addons,
      clientPhone,
      clientName,
      clientInstructions, // ⭐ optional special instructions from client
    } = body;

    const { total, subtotal, markupAmount, markupRate, markupPercent } =
      normalizeNumbersFromBody(body);

    if (!clientId || !providerId || !videoId || !date || !time || !total) {
      return NextResponse.json(
        { error: "Missing required fields" },
        { status: 400 },
      );
    }

    // Get provider details
    const providerSnap = await adminDb
      .collection("users")
      .doc(providerId)
      .get();
    if (!providerSnap.exists) {
      return NextResponse.json(
        { error: "Provider not found" },
        { status: 404 },
      );
    }

    const provider = providerSnap.data();
    if (!provider?.businessPhone) {
      return NextResponse.json(
        { error: "Provider business phone is missing" },
        { status: 400 },
      );
    }

    const slotsRef = adminDb.collection("booked_slots");

    // ✅ If updating an existing booking
    if (bookingId) {
      const existingRef = adminDb.collection("bookings").doc(bookingId);
      const existingSnap = await existingRef.get();

      if (!existingSnap.exists) {
        return NextResponse.json(
          { error: "Existing booking not found" },
          { status: 404 },
        );
      }

      const existing = existingSnap.data() as any;

      // Free up previous slot if date/time changed
      if (existing.time !== time || existing.date !== date) {
        const oldSlotKey = `${providerId}_${existing.date}_${existing.time}`;
        const oldSlotDoc = await slotsRef.doc(oldSlotKey).get();
        if (oldSlotDoc.exists) await slotsRef.doc(oldSlotKey).delete();
      }

      // For updates, if frontend didn't send subtotal/markup, keep old values
      const safeSubtotal =
        typeof subtotal === "number" && subtotal > 0
          ? subtotal
          : typeof existing.subtotal === "number"
          ? existing.subtotal
          : total;

      const safeMarkupAmount =
        typeof markupAmount === "number"
          ? markupAmount
          : typeof existing.markupAmount === "number"
          ? existing.markupAmount
          : total - safeSubtotal;

      const safeMarkupRate =
        typeof markupRate === "number"
          ? markupRate
          : typeof existing.markupRate === "number"
          ? existing.markupRate
          : safeSubtotal > 0
          ? safeMarkupAmount / safeSubtotal
          : 0;

      const safeMarkupPercent =
        typeof markupPercent === "number"
          ? markupPercent
          : typeof existing.markupPercent === "number"
          ? existing.markupPercent
          : safeMarkupRate * 100;

      // Update the booking details
      await existingRef.update({
        date,
        time,
        total,
        subtotal: safeSubtotal,
        markupAmount: safeMarkupAmount,
        markupRate: safeMarkupRate,
        markupPercent: safeMarkupPercent,
        platformFee: safeMarkupAmount,
        providerAmount: safeSubtotal,
        addons: addons || [],
        status: "pending", // reset to pending until payment confirmed
        updatedAt: Date.now(),
        clientPhone: clientPhone || null,
        clientName: clientName || "",
        clientInstructions:
          typeof clientInstructions === "string"
            ? clientInstructions
            : existing.clientInstructions || "",
      });

      return NextResponse.json({ bookingId, updated: true }, { status: 200 });
    }

    // ✅ Otherwise, create a new booking
    const shortId = generateShortId();

    // 🔐 Generate completion PIN, store hash, return plain PIN once
    const completionPin = generateReleasePin(4);
    const completionPinHash = hashPin(completionPin);

    const safeSubtotal = subtotal || total;
    const safeMarkupAmount =
      typeof markupAmount === "number"
        ? markupAmount
        : total - safeSubtotal;
    const safeMarkupRate =
      typeof markupRate === "number"
        ? markupRate
        : safeSubtotal > 0
        ? safeMarkupAmount / safeSubtotal
        : 0;
    const safeMarkupPercent =
      typeof markupPercent === "number"
        ? markupPercent
        : safeMarkupRate * 100;

    const bookingRef = await adminDb.collection("bookings").add({
      clientId,
      providerId,
      videoId,
      date,
      time,
      subtotal: safeSubtotal,
      total,
      markupAmount: safeMarkupAmount,
      markupRate: safeMarkupRate,
      markupPercent: safeMarkupPercent,
      platformFee: safeMarkupAmount,
      providerAmount: safeSubtotal,
      addons: addons || [],
      status: "pending",
      createdAt: Date.now(),
      clientPhone: clientPhone || null,
      providerPhone: provider.businessPhone,
      clientName: clientName || "",
      creatorName: provider.fullName || provider.username || "Unknown",
      shortId, // ✅ store memorable ID
      completionPinHash, // 🔐 hashed PIN used for verification
      completionPin, // 🔐 plain PIN for client-facing UIs (you can drop later if you want client-only storage)
      releaseVerified: false, // 🔐 funds not yet released to provider
      clientInstructions:
        typeof clientInstructions === "string" ? clientInstructions : "",
    });

    return NextResponse.json(
      {
        bookingId: bookingRef.id,
        shortId,
        completionPin, // 🔐 send PIN to frontend (booking modal / summary)
      },
      { status: 200 },
    );
  } catch (err: any) {
    console.error("save-booking error:", err?.message || err);
    return NextResponse.json(
      { error: err?.message || "Unknown error" },
      { status: 500 },
    );
  }
}