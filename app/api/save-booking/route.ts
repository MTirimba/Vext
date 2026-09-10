// /workspaces/Vext/app/api/save-booking/route.ts
import { NextRequest, NextResponse } from "next/server";
import { adminDb } from "@/lib/firebaseAdmin";
import { requireAuth } from "@/lib/requireAuth";
import { computeLogisticsFee, parseLogisticsConfig } from "@/lib/logistics";
import {
  sendNewBookingProviderNotification,
  sendBookingReceivedClientNotification,
} from "@/lib/whatsappNotifications";
import crypto from "crypto";

// helper: generate short code like "42AB"
function generateShortId() {
  const letters = "ABCDEFGHJKLMNPQRSTUVWXYZ"; // no confusing chars
  const digits = "0123456789";
  let result = "";

  for (let i = 0; i < 2; i++) {
    result += digits.charAt(Math.floor(Math.random() * digits.length));
  }

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
    // 🔐 Must be signed in — identity comes from the verified token
    const auth = await requireAuth(req);
    if (auth instanceof NextResponse) return auth;

    const body = await req.json();
    const {
      bookingId,
      clientId,
      providerId,
      videoId,
      serviceName,
      date,
      time,
      addons,
      clientPhone,
      clientName,
      clientInstructions, // ⭐ optional special instructions from client
      serviceLocationType, // 🚗 "onsite" | "housecall"
      housecallAddress, // 🚗 required if serviceLocationType === "housecall"
      housecallGeo, // 🚗 optional structured { lat, lng, street, town, county, landmark, building, floor, room }
    } = body;

    const { total, subtotal, markupAmount, markupRate, markupPercent } =
      normalizeNumbersFromBody(body);

    if (!clientId || !providerId || !videoId || !date || !time || !total) {
      return NextResponse.json(
        { error: "Missing required fields" },
        { status: 400 },
      );
    }

    // 🔐 The signed-in user can only create/edit their own bookings as a client
    if (auth.uid !== clientId) {
      return NextResponse.json(
        { error: "You can only manage your own bookings" },
        { status: 403 },
      );
    }

    // 🚗 Normalize/validate mobile-service selection
    const safeServiceLocationType: "onsite" | "housecall" =
      serviceLocationType === "housecall" ? "housecall" : "onsite";
    const safeHousecallAddress =
      typeof housecallAddress === "string" ? housecallAddress.trim() : "";

    if (safeServiceLocationType === "housecall" && !safeHousecallAddress) {
      return NextResponse.json(
        { error: "housecallAddress is required when serviceLocationType is 'housecall'" },
        { status: 400 },
      );
    }

    // Basic sanity check on the structured geo payload, if provided
    const safeHousecallGeo =
      safeServiceLocationType === "housecall" &&
      housecallGeo &&
      typeof housecallGeo === "object"
        ? {
            lat: typeof housecallGeo.lat === "number" ? housecallGeo.lat : null,
            lng: typeof housecallGeo.lng === "number" ? housecallGeo.lng : null,
            street: String(housecallGeo.street || ""),
            town: String(housecallGeo.town || ""),
            city: String(housecallGeo.city || ""),
            county: String(housecallGeo.county || ""),
            landmark: String(housecallGeo.landmark || ""),
            building: String(housecallGeo.building || ""),
            floor: String(housecallGeo.floor || ""),
            room: String(housecallGeo.room || ""),
          }
        : null;

    // Get provider details — fetched once, up front, and reused below for
    // the mobile-availability check and the logistics fee calculation.
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

    const provider = providerSnap.data() as any;
    if (!provider?.businessPhone) {
      return NextResponse.json(
        { error: "Provider business phone is missing" },
        { status: 400 },
      );
    }

    if (safeServiceLocationType === "housecall") {
      // "Services offered" (the simple provider price-list, distinct from
      // uploaded videos) use synthetic ids like `svc_<id>` since they don't
      // have a real doc in the `videos` collection — look them up on the
      // provider's user doc instead.
      let offersMobile = false;
      if (typeof videoId === "string" && videoId.startsWith("svc_")) {
        const svcId = videoId.slice("svc_".length);
        const offered: any[] = provider?.servicesOffered || [];
        const svc = offered.find((s) => s?.id === svcId);
        offersMobile = !!svc?.availableForMobileService;
      } else {
        const videoSnap = await adminDb.collection("videos").doc(videoId).get();
        const videoData = videoSnap.exists ? (videoSnap.data() as any) : null;
        offersMobile = !!videoData?.availableForMobileService;
      }

      if (!offersMobile) {
        return NextResponse.json(
          { error: "This service is not available for housecall/outcall." },
          { status: 400 },
        );
      }
    }

    // 🚗💰 Logistics fee for housecall bookings — computed server-side from
    // the platform-wide rate in config/pricing, never trusted from the
    // client. Added on top of both `total` and `subtotal` equally so the
    // markup calculation elsewhere is unaffected and the fee flows 100% to
    // the provider (see providerAmount below).
    let logisticsFee = 0;
    let logisticsDistanceKm: number | null = null;
    let logisticsFeeFallbackUsed = false;

    if (safeServiceLocationType === "housecall") {
      const pricingSnap = await adminDb.collection("config").doc("pricing").get();
      const logisticsCfg = parseLogisticsConfig(
        pricingSnap.exists ? (pricingSnap.data() as any)?.logistics : null,
      );
      const result = computeLogisticsFee({
        providerLat: typeof provider?.lat === "number" ? provider.lat : null,
        providerLng: typeof provider?.lng === "number" ? provider.lng : null,
        clientLat: safeHousecallGeo?.lat ?? null,
        clientLng: safeHousecallGeo?.lng ?? null,
        config: logisticsCfg,
      });
      logisticsFee = result.fee;
      logisticsDistanceKm = result.distanceKm;
      logisticsFeeFallbackUsed = result.usedFallback;
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

      // 🔐 Prevent editing someone else's booking by pointing bookingId at it
      // while claiming a different (your own) clientId in the body
      if (existing.clientId !== auth.uid) {
        return NextResponse.json(
          { error: "You can only manage your own bookings" },
          { status: 403 },
        );
      }

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
        serviceName: typeof serviceName === "string" && serviceName ? serviceName : existing.serviceName || "",
        total: total + logisticsFee,
        subtotal: safeSubtotal + logisticsFee,
        markupAmount: safeMarkupAmount,
        markupRate: safeMarkupRate,
        markupPercent: safeMarkupPercent,
        platformFee: safeMarkupAmount,
        providerAmount: safeSubtotal + logisticsFee,
        addons: addons || [],
        status: "pending", // reset to pending until payment confirmed
        updatedAt: Date.now(),
        clientPhone: clientPhone || null,
        clientName: clientName || "",
        clientInstructions:
          typeof clientInstructions === "string"
            ? clientInstructions
            : existing.clientInstructions || "",
        serviceLocationType: safeServiceLocationType,
        housecallAddress:
          safeServiceLocationType === "housecall" ? safeHousecallAddress : null,
        housecallGeo: safeHousecallGeo,
        logisticsFee: safeServiceLocationType === "housecall" ? logisticsFee : 0,
        logisticsDistanceKm:
          safeServiceLocationType === "housecall" ? logisticsDistanceKm : null,
        logisticsFeeFallbackUsed:
          safeServiceLocationType === "housecall" ? logisticsFeeFallbackUsed : false,
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
      serviceName: typeof serviceName === "string" ? serviceName : "",
      date,
      time,
      subtotal: safeSubtotal + logisticsFee,
      total: total + logisticsFee,
      markupAmount: safeMarkupAmount,
      markupRate: safeMarkupRate,
      markupPercent: safeMarkupPercent,
      platformFee: safeMarkupAmount,
      providerAmount: safeSubtotal + logisticsFee,
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
      serviceLocationType: safeServiceLocationType,
      housecallAddress:
        safeServiceLocationType === "housecall" ? safeHousecallAddress : null,
      housecallGeo: safeHousecallGeo,
      logisticsFee: safeServiceLocationType === "housecall" ? logisticsFee : 0,
      logisticsDistanceKm:
        safeServiceLocationType === "housecall" ? logisticsDistanceKm : null,
      logisticsFeeFallbackUsed:
        safeServiceLocationType === "housecall" ? logisticsFeeFallbackUsed : false,
    });

    // 🟢 Best-effort WhatsApp notifications — never block the booking
    // response on these. Provider notification (new_booking_provider) is
    // registered and live; client notification (booking_received_client)
    // is still pending Meta approval and will just no-op quietly until then.
    try {
      const resolvedServiceName = typeof serviceName === "string" ? serviceName : "";
      const providerName = provider.fullName || provider.username || "Unknown";

      await sendNewBookingProviderNotification({
        providerPhone: provider.businessPhone,
        providerName,
        clientName: clientName || "Client",
        serviceName: resolvedServiceName,
        date,
        time,
        bookingId: bookingRef.id,
      });

      if (clientPhone) {
        await sendBookingReceivedClientNotification({
          clientPhone,
          clientName: clientName || "there",
          providerName,
          serviceName: resolvedServiceName,
          date,
          time,
          bookingId: bookingRef.id,
        });
      }
    } catch (err) {
      console.error("save-booking: WhatsApp notification failed", err);
    }

    return NextResponse.json(
      {
        bookingId: bookingRef.id,
        shortId,
        completionPin, // 🔐 send PIN to frontend (booking modal / summary)
        total: total + logisticsFee,
        logisticsFee,
        logisticsDistanceKm,
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