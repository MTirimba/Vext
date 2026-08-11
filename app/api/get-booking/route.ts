// /workspaces/Vext/app/api/get-booking/route.ts
import { NextResponse } from "next/server";
import { adminDb } from "@/lib/firebaseAdmin";
import { requireAuth } from "@/lib/requireAuth";

export async function GET(req: Request) {
  try {
    // 🔐 Must be signed in — this endpoint returns the completion PIN,
    // which should only ever go to the client who owns the booking.
    const auth = await requireAuth(req);
    if (auth instanceof NextResponse) return auth;

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

    // 🔐 Only the client who owns this booking can view it
    if (!booking.clientId || auth.uid !== booking.clientId) {
      return NextResponse.json(
        { error: "You are not allowed to view this booking" },
        { status: 403 },
      );
    }

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