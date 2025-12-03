"use client";
import { useEffect, useState } from "react";
import {
  collection,
  query,
  where,
  getDocs,
  deleteDoc,
  doc,
  updateDoc,
  addDoc,
  getDoc,
} from "firebase/firestore";
import { db, auth } from "@/lib/firebase";
import { useAuthState } from "react-firebase-hooks/auth";
import Calendar from "react-calendar";
import "react-calendar/dist/Calendar.css";
import { FaWhatsapp, FaPhoneAlt } from "react-icons/fa";
import MessageButton from "@/components/MessageButton";

interface Booking {
  id: string;
  status?: string;
  shortId?: string;
  providerId?: string;
  clientId?: string;
  videoId?: string;
  date?: string;
  time?: string;
  total?: number;
  clientPhone?: string;
  providerPhone?: string;
  completionPin?: string; // 🔐 Service release PIN

  clientInstructions?: string; // ⭐ client's own note

  [key: string]: any;
}

interface Video {
  title?: string;
  description?: string;
  details?: string;
  url?: string;
  thumbnailUrl?: string;
  imageUrl?: string;
}

interface UserProfile {
  businessName?: string;
  fullName?: string;
  name?: string;

  phone?: string;
  businessPhone?: string;

  location?: string;
  street?: string;
  town?: string;
  county?: string;

  building?: string;
  floor?: string;
  room?: string;

  lat?: number;
  lng?: number;
}

export default function ClientBookings() {
  const [user] = useAuthState(auth);
  const [active, setActive] = useState<
    (Booking & { video?: Video; provider?: UserProfile })[]
  >([]);
  const [completed, setCompleted] = useState<
    (Booking & { video?: Video; provider?: UserProfile })[]
  >([]);
  const [rescheduling, setRescheduling] = useState<
    (Booking & { video?: Video; provider?: UserProfile }) | null
  >(null);
  const [newDate, setNewDate] = useState<Date>(new Date());
  const [newTime, setNewTime] = useState<string>("");

  useEffect(() => {
    if (!user) return;
    (async () => {
      const snap = await getDocs(
        query(collection(db, "bookings"), where("clientId", "==", user.uid)),
      );
      const arr = await Promise.all(
        snap.docs.map(async (d) => {
          const base = { id: d.id, ...d.data() } as Booking;

          let video: Video | undefined;
          if (base.videoId) {
            const vs = await getDoc(doc(db, "videos", base.videoId));
            if (vs.exists()) {
              const v = vs.data() as any;
              video = {
                title: v.title,
                description: v.description,
                details: v.details,
                url: v.url,
                thumbnailUrl: v.thumbnailUrl,
                imageUrl: v.imageUrl,
              };
            }
          }

          let provider: UserProfile | undefined;
          if (base.providerId) {
            const ps = await getDoc(doc(db, "users", base.providerId));
            if (ps.exists()) provider = ps.data() as UserProfile;
          }

          return { ...base, video, provider };
        }),
      );

      // treat accepted/confirmed as active, and show rejected/cancelled in history
      setActive(
        (arr as any[]).filter((b) =>
          ["pending", "accepted", "confirmed"].includes(
            (b.status || "").toLowerCase(),
          ),
        ),
      );
      setCompleted(
        (arr as any[]).filter((b) =>
          ["completed", "rejected", "cancelled", "canceled"].includes(
            (b.status || "").toLowerCase(),
          ),
        ),
      );
    })();
  }, [user]);

  const manageTimeSlot = async (
    providerId: string,
    date: string,
    time: string,
    release = false,
  ) => {
    const slotsRef = collection(db, "providerSlots");
    const qy = query(
      slotsRef,
      where("providerId", "==", providerId),
      where("date", "==", date),
      where("time", "==", time),
    );
    const snap = await getDocs(qy);
    if (release) {
      if (!snap.empty)
        await deleteDoc(doc(db, "providerSlots", snap.docs[0].id));
    } else {
      if (snap.empty)
        await addDoc(slotsRef, {
          providerId,
          date,
          time,
          booked: true,
          createdAt: Date.now(),
        });
      else throw new Error("This time slot is no longer available.");
    }
  };

  // 🚫 Cancel booking from client side (now via backend API with wallet refund)
  const cancel = async (id: string) => {
    const booking = active.find((b) => b.id === id);
    if (!booking) return;

    if (!confirm("Are you sure you want to cancel this booking?")) return;

    try {
      const res = await fetch("/api/cancel-booking", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          bookingId: id,
          clientId: user?.uid,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Failed to cancel booking.");
      }

      // update UI lists
      setActive((prev) => prev.filter((b) => b.id !== id));
      setCompleted((prev) => [
        ...prev,
        { ...(booking as any), status: "cancelled" },
      ]);

      alert(
        data.refunded
          ? "Booking cancelled. Any paid amount has been moved to your wallet."
          : "Booking cancelled.",
      );
    } catch (err: any) {
      alert(err.message || "Error while cancelling. Please try again.");
    }
  };

  const openReschedule = (
    booking: Booking & { video?: Video; provider?: UserProfile },
  ) => {
    setRescheduling(booking);
    if (booking.date) setNewDate(new Date(booking.date));
    if (booking.time) setNewTime(booking.time);
  };

  const confirmReschedule = async () => {
    if (!rescheduling || !newTime) return alert("Select a new time");
    const ref = doc(db, "bookings", rescheduling.id);
    try {
      // release old slot
      await manageTimeSlot(
        rescheduling.providerId!,
        rescheduling.date!,
        rescheduling.time!,
        true,
      );
      const newDateISO = new Date(newDate).toISOString();

      // reserve new slot
      await manageTimeSlot(rescheduling.providerId!, newDateISO, newTime, false);

      // update booking
      await updateDoc(ref, {
        date: newDateISO,
        time: newTime,
        status: "pending",
        rescheduledAt: Date.now(),
      });

      setActive((prev) =>
        prev.map((b) =>
          b.id === rescheduling.id
            ? { ...b, date: newDateISO, time: newTime }
            : b,
        ),
      );

      // SMS both client & provider
      await fetch("/api/send-sms", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          to: [rescheduling.clientPhone, rescheduling.providerPhone].filter(
            Boolean,
          ),
          message: `Booking #${
            rescheduling.shortId || rescheduling.id
          } rescheduled to ${new Date(newDateISO).toDateString()} at ${newTime}.`,
        }),
      });

      // 🔔 notify provider via backend
      try {
        await fetch("/api/booking-change-notification", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            bookingId: rescheduling.id,
            changeType: "rescheduled",
          }),
        });
      } catch (notifyErr) {
        console.error("Failed to send reschedule notification:", notifyErr);
      }

      setRescheduling(null);
    } catch (err: any) {
      alert(err.message || "Error while rescheduling. Try another time.");
    }
  };

  const providerName = (p?: UserProfile) =>
    p?.businessName || p?.fullName || p?.name || "Service Provider";

  const providerAddressLine = (p?: UserProfile) => {
    if (!p) return "";
    const parts = [p.street, p.town, p.county].filter(Boolean);
    return parts.length ? parts.join(", ") : p.location || "";
  };

  const providerVenueLine = (p?: UserProfile) => {
    if (!p) return "";
    const parts = [
      p.building ? `Building: ${p.building}` : "",
      p.floor ? `Floor: ${p.floor}` : "",
      p.room ? `Room: ${p.room}` : "",
    ].filter(Boolean);
    return parts.join(" • ");
  };

  const providerMapLink = (p?: UserProfile) => {
    if (!p) return "";
    if (typeof p.lat === "number" && typeof p.lng === "number") {
      return `https://www.google.com/maps/search/?api=1&query=${p.lat},${p.lng}`;
    }
    const text = providerAddressLine(p) || p.location || "";
    return text
      ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
          text,
        )}`
      : "";
  };

  // tel & WhatsApp helpers
  const telHref = (n?: string) => (n ? `tel:${n.replace(/\s+/g, "")}` : "");
  const waHref = (n?: string) => {
    if (!n) return "";
    const digits = n.replace(/[^\d]/g, "");
    return digits ? `https://wa.me/${digits}` : "";
  };

  const BookingCard = ({
    b,
    actions,
  }: {
    b: Booking & { video?: Video; provider?: UserProfile };
    actions?: React.ReactNode;
  }) => {
    const addr = providerAddressLine(b.provider);
    const venue = providerVenueLine(b.provider);
    const mapUrl = providerMapLink(b.provider);

    // ✅ Only show BUSINESS phone (preferred), or a booking-level providerPhone
    const providerNumber =
      b.provider?.businessPhone || b.providerPhone || undefined;

    const myNumber = b.clientPhone;

    return (
      <div className="border p-3 mb-3 rounded shadow">
        <div className="grid grid-cols-1 md:grid-cols-5 gap-4 items-start">
          <div className="md:col-span-3">
            {b.video?.title && (
              <h3 className="text-lg font-semibold">{b.video.title}</h3>
            )}
            {b.video?.description && (
              <p className="text-gray-700">{b.video.description}</p>
            )}

            <p className="mt-2">
              <strong>Booking ID:</strong> {b.shortId || b.id}
            </p>

            {b.completionPin && (
              <>
                <p>
                  <strong>Service Release PIN:</strong> {b.completionPin}
                </p>
                <p className="text-xs text-gray-600 mt-1">
                  Share this PIN with your service provider only to confirm that
                  the service has been delivered.
                </p>
              </>
            )}

            <p>
              <strong>Date:</strong>{" "}
              {b.date ? new Date(b.date).toLocaleDateString() : "-"}
            </p>
            <p>
              <strong>Time:</strong> {b.time || "-"}
            </p>
            <p>
              <strong>Total:</strong> KSHS {b.total ?? "-"}
            </p>

            {/* ⭐ show what the client wrote */}
            {b.clientInstructions && (
              <div className="mt-2 p-2 rounded bg-gray-50 border text-xs text-gray-800 whitespace-pre-wrap">
                <span className="font-semibold">
                  Your note to the provider:
                </span>{" "}
                {b.clientInstructions}
              </div>
            )}

            {/* phones with icons + message button */}
            <div className="mt-3 space-y-1 text-sm">
              {providerNumber && (
                <div className="flex flex-wrap items-center gap-2">
                  <a
                    className="inline-flex items-center justify-center w-8 h-8 rounded-full bg-blue-50 hover:bg-blue-100"
                    href={telHref(providerNumber)}
                    title="Call provider"
                    aria-label="Call provider"
                  >
                    <FaPhoneAlt className="text-blue-600" />
                  </a>
                  {waHref(providerNumber) && (
                    <a
                      className="inline-flex items-center justify-center w-8 h-8 rounded-full bg-green-50 hover:bg-green-100"
                      href={waHref(providerNumber)}
                      target="_blank"
                      rel="noopener noreferrer"
                      title="WhatsApp provider"
                      aria-label="WhatsApp provider"
                    >
                      <FaWhatsapp className="text-green-600" />
                    </a>
                  )}
                  <span className="text-gray-800">{providerNumber}</span>

                  {/* 💬 Message provider on-platform */}
                  {user && b.providerId && (
                    <div className="ml-2">
                      <MessageButton
                        currentUserId={user.uid}
                        otherUserId={b.providerId}
                        redirectToList
                      />
                    </div>
                  )}
                </div>
              )}
              {myNumber && (
                <div className="flex items-center gap-2">
                  <a
                    className="inline-flex items-center justify-center w-8 h-8 rounded-full bg-blue-50 hover:bg-blue-100"
                    href={telHref(myNumber)}
                    title="Call my number"
                    aria-label="Call my number"
                  >
                    <FaPhoneAlt className="text-blue-600" />
                  </a>
                  {waHref(myNumber) && (
                    <a
                      className="inline-flex items-center justify-center w-8 h-8 rounded-full bg-green-50 hover:bg-green-100"
                      href={waHref(myNumber)}
                      target="_blank"
                      rel="noopener noreferrer"
                      title="WhatsApp my number"
                      aria-label="WhatsApp my number"
                    >
                      <FaWhatsapp className="text-green-600" />
                    </a>
                  )}
                  <span className="text-gray-800">{myNumber}</span>
                </div>
              )}
            </div>

            {/* provider location */}
            <div className="mt-3 space-y-1">
              <p>
                <strong>Provider:</strong> {providerName(b.provider)}
              </p>
              {addr && (
                <p>
                  <strong>Address:</strong> {addr}
                </p>
              )}
              {venue && (
                <p>
                  <strong>Venue:</strong> {venue}
                </p>
              )}
              {mapUrl && (
                <p>
                  <a
                    href={mapUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-blue-600 underline"
                  >
                    View on Map
                  </a>
                </p>
              )}
            </div>

            {actions}
          </div>

          <div className="md:col-span-2 flex items-start justify-center md:justify-end">
            {b.video?.url ? (
              <video
                src={b.video.url}
                className="w-full max-w-md h-64 md:h-80 lg:h-96 object-contain rounded bg-black"
                controls
                playsInline
                muted
              />
            ) : b.video?.thumbnailUrl || b.video?.imageUrl ? (
              <img
                src={b.video.thumbnailUrl || b.video.imageUrl}
                alt={b.video.title || "Booking Media"}
                className="w-full max-w-md h-64 md:h-80 lg:h-96 object-contain rounded bg-gray-100"
              />
            ) : (
              <div className="w-full max-w-md h-64 md:h-80 lg:h-96 bg-gray-200 rounded flex items-center justify-center text-gray-500">
                No preview available
              </div>
            )}
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="p-6">
      <h1 className="text-2xl font-bold mb-4">My Bookings</h1>

      <section className="mb-6">
        <h2 className="text-xl">Active / Pending</h2>
        {active.map((b) => (
          <BookingCard
            key={b.id}
            b={b}
            actions={
              <div className="mt-3 space-x-3">
                <button onClick={() => cancel(b.id)} className="text-red-600">
                  Cancel
                </button>
                <button
                  onClick={() => openReschedule(b)}
                  className="text-blue-600"
                >
                  Reschedule
                </button>
              </div>
            }
          />
        ))}
        {active.length === 0 && (
          <p className="text-sm text-gray-600 mt-2">No active bookings.</p>
        )}
      </section>

      <section>
        <h2 className="text-xl">Completed & Past</h2>
        {completed.map((b) => (
          <BookingCard key={b.id} b={b} />
        ))}
        {completed.length === 0 && (
          <p className="text-sm text-gray-600 mt-2">No completed bookings.</p>
        )}
      </section>

      {rescheduling && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
          <div className="bg-white p-6 rounded-lg w=[90vw] max-w-md">
            <h3 className="text-lg font-bold mb-4">Reschedule Booking</h3>
            <Calendar onChange={(d) => setNewDate(d as Date)} value={newDate} />
            <label className="block mt-4 mb-2">Select New Time:</label>
            <select
              className="w-full border rounded px-2 py-1"
              value={newTime}
              onChange={(e) => setNewTime(e.target.value)}
            >
              <option value="">-- time --</option>
              {[
                "09:00",
                "10:00",
                "11:00",
                "12:00",
                "13:00",
                "14:00",
                "15:00",
                "16:00",
                "17:00",
              ].map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
            <div className="flex justify-end mt-6 space-x-2">
              <button
                onClick={() => setRescheduling(null)}
                className="px-4 py-2"
              >
                Cancel
              </button>
              <button
                onClick={confirmReschedule}
                className="bg-green-600 text-white px-4 py-2 rounded"
              >
                Confirm
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}