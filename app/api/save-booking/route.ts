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

/**
 * ✅ Handles both new and updated bookings.
 * - If bookingId is passed, update existing booking.
 * - If not, create a new booking.
 * - Automatically frees old slot if time changed.
 */
export async function POST(req: NextRequest) {
  try {
    const {
      bookingId,
      clientId,
      providerId,
      videoId,
      date,
      time,
      total,
      addons,
      clientPhone,
      clientName,
    } = await req.json();

    if (!clientId || !providerId || !videoId || !date || !time || !total) {
      return NextResponse.json(
        { error: "Missing required fields" },
        { status: 400 },
      );
    }

    // Get provider details
    const providerSnap = await adminDb.collection("users").doc(providerId).get();
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

      // Update the booking details
      await existingRef.update({
        date,
        time,
        total,
        addons: addons || [],
        status: "pending", // reset to pending until payment confirmed
        updatedAt: Date.now(),
        clientPhone: clientPhone || null,
        clientName: clientName || "",
      });

      return NextResponse.json({ bookingId, updated: true }, { status: 200 });
    }

    // ✅ Otherwise, create a new booking
    const shortId = generateShortId();

    // 🔐 Generate completion PIN, store hash, return plain PIN once
    const completionPin = generateReleasePin(4);
    const completionPinHash = hashPin(completionPin);

    const bookingRef = await adminDb.collection("bookings").add({
      clientId,
      providerId,
      videoId,
      date,
      time,
      total,
      addons: addons || [],
      status: "pending",
      createdAt: Date.now(),
      clientPhone: clientPhone || null,
      providerPhone: provider.businessPhone,
      clientName: clientName || "",
      creatorName: provider.fullName || provider.username || "Unknown",
      shortId, // ✅ store memorable ID
      completionPinHash, // 🔐 hashed PIN used for verification
      completionPin, // 🔐 plain PIN for client-facing UIs (optional, you can later drop if you want it only client-side)
      releaseVerified: false, // 🔐 funds not yet released to provider
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