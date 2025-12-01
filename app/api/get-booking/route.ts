// /app/api/get-booking/route.ts
import { NextResponse } from "next/server";
import { adminDb } from "@/lib/firebaseAdmin";

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const bookingId = searchParams.get("bookingId");

    if (!bookingId) {
      return NextResponse.json({ error: "Missing bookingId" }, { status: 400 });
    }

    const bookingSnap = await adminDb.collection("bookings").doc(bookingId).get();

    if (!bookingSnap.exists) {
      return NextResponse.json({ error: "Booking not found" }, { status: 404 });
    }

    const booking = bookingSnap.data() as any;

    // Enrich details with provider info
    const providerSnap = await adminDb
      .collection("users")
      .doc(booking.providerId)
      .get();
    const provider = providerSnap.exists ? providerSnap.data() : {};

    const videoSnap = await adminDb
      .collection("videos")
      .doc(booking.videoId)
      .get();
    const video = videoSnap.exists ? videoSnap.data() : {};

    return NextResponse.json({
      bookingId,
      date: booking.date,
      time: booking.time,
      total: booking.total,
      providerBusinessName:
        provider?.businessName || provider?.fullName || "Unknown",
      providerLocation: provider?.location || "Not specified",
      videoDescription: video?.description || "Service description unavailable",

      // 🔐 Service Release PIN + disclaimer
      completionPin: booking.completionPin || null,
      completionPinNote:
        booking.completionPin
          ? "Share this PIN with your service provider only to confirm that the service has been delivered."
          : null,
    });
  } catch (err: any) {
    console.error("🔥 Error fetching booking details:", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}