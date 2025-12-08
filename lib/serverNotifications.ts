// /workspaces/Vext/lib/serverNotifications.ts
import { NextRequest, NextResponse } from "next/server";
import { adminDb } from "@/lib/firebaseAdmin";
import crypto from "crypto";
// ❌ removed incorrect self-import of createUserNotification
// import { createUserNotification } from "@/lib/serverNotifications";

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

      // (Optional) You *could* send a "booking-updated" style notification
      // here if you want the provider to know it was rescheduled.
      // e.g.:
      // await createUserNotification(providerId, {
      //   type: "generic",
      //   role: "provider",
      //   bookingId,
      //   bookingStatus: "pending",
      //   message: `Booking was updated to ${date} at ${time}.`,
      // });

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
      completionPin, // 🔐 plain PIN for client-facing UIs (optional)
      releaseVerified: false, // 🔐 funds not yet released to provider
    });

    // 🔔 NEW: notify provider about the booking request
    try {
      await createUserNotification(providerId, {
        type: "new-booking",
        role: "provider",
        bookingId: bookingRef.id,
        bookingStatus: "pending",
        // You can add smarter text later (e.g. include service name)
        message: `New booking from ${clientName || "a client"} on ${date} at ${time}.`,
      });
    } catch (notifyErr: any) {
      console.error("Failed to create provider notification:", notifyErr?.message || notifyErr);
      // Don't fail the booking just because notification failed
    }

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

/**
 * ✅ Exported helper used by other API routes to create user notifications.
 */
export async function createUserNotification(
  userId: string,
  payload: {
    type: string;
    role?: string;
    bookingId?: string;
    bookingStatus?: string;
    message: string;
    data?: Record<string, unknown>;
  },
) {
  const now = Date.now();

  const ref = adminDb
    .collection("users")
    .doc(userId)
    .collection("notifications")
    .doc();

  const doc = {
    userId,
    type: payload.type,
    role: payload.role ?? null,
    bookingId: payload.bookingId ?? null,
    bookingStatus: payload.bookingStatus ?? null,
    message: payload.message,
    data: payload.data ?? null,
    read: false,
    createdAt: now,
    updatedAt: now,
  };

  await ref.set(doc);

  return {
    id: ref.id,
    ...doc,
  };
}