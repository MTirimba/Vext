"use client";

import { useEffect, useState, useMemo } from "react";
import { useRouter } from "next/navigation";
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
  serverTimestamp,
} from "firebase/firestore";
import { db, auth } from "@/lib/firebase";
import { useAuthState } from "react-firebase-hooks/auth";
import Calendar from "react-calendar";
import "react-calendar/dist/Calendar.css";
import { FaWhatsapp, FaPhoneAlt, FaSortAmountDownAlt } from "react-icons/fa";

/* ---------- Types ---------- */

interface Booking {
  id: string;
  status?: string;
  shortId?: string;
  providerId?: string;
  clientId?: string;
  videoId?: string;
  date?: string;
  time?: string;

  // 💰 Client-facing fields
  total?: number; // client total (with markup)

  // pricing extras (may or may not exist on every doc)
  subtotal?: number; // provider base
  markupAmount?: number; // fee amount
  platformFee?: number; // alias for markup
  providerAmount?: number; // provider share

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
  businessLocationType?: "shop" | "mobile_only" | "both";
}

/* ---------- Local date helpers (avoid UTC shifting) ---------- */

// Local date-only ISO: always "YYYY-MM-DD" for the local calendar day
function dateToISO(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

// Parse booking.date safely, handling both "YYYY-MM-DD" and full ISO strings
function parseBookingDate(raw: string): Date {
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    const [y, m, d] = raw.split("-").map((x) => parseInt(x, 10));
    return new Date(y, (m || 1) - 1, d || 1); // local midnight
  }
  const dt = new Date(raw);
  if (!isNaN(dt.getTime())) return dt;
  return new Date();
}

// UI-friendly display for dates (no weird shifts)
function displayDate(raw?: string): string {
  if (!raw) return "-";
  try {
    const d = parseBookingDate(raw);
    if (isNaN(d.getTime())) return "-";
    return d.toLocaleDateString();
  } catch {
    return "-";
  }
}

/**
 * 💰 Always show what the client actually paid (with markup).
 * Prefer `total`, but fall back to subtotal + fee if needed.
 */
function clientDisplayTotal(b: Booking): number | null {
  // 1) Normal case – total is stored as client-charged amount
  const t = Number(b.total);
  if (!isNaN(t) && t > 0) {
    return Math.round(t * 100) / 100;
  }

  // 2) If we have subtotal + markup/platformFee, reconstruct
  const subtotal = Number(b.subtotal);
  const markupAmount = Number(
    b.markupAmount ??
      b.platformFee ??
      (b as any).fee ??
      (b as any).serviceFee,
  );
  if (!isNaN(subtotal) && subtotal > 0) {
    const fee = !isNaN(markupAmount) && markupAmount >= 0 ? markupAmount : 0;
    const combined = subtotal + fee;
    if (combined > 0) {
      return Math.round(combined * 100) / 100;
    }
  }

  // 3) As a last resort, if only providerAmount + platformFee exists
  const providerAmount = Number(b.providerAmount);
  const platformFee = Number(
    b.platformFee ?? b.markupAmount ?? (b as any).fee,
  );
  if (!isNaN(providerAmount) && providerAmount > 0) {
    const combined =
      providerAmount +
      (!isNaN(platformFee) && platformFee >= 0 ? platformFee : 0);
    if (combined > 0) {
      return Math.round(combined * 100) / 100;
    }
  }

  return null;
}

/* ---------- Sorting helpers ---------- */

type SortMode = "newest" | "oldest" | "id" | "cost";

// Try to get a reasonable numeric "time" for sorting
function bookingTimeValue(b: Booking): number {
  // Prefer explicit date field (bookings.date)
  if (b.date) {
    try {
      const d = parseBookingDate(b.date);
      const t = d.getTime();
      if (!isNaN(t)) return t;
    } catch {
      // ignore and fall through
    }
  }

  // Fallback: createdAt if present (number or Firestore Timestamp)
  const createdAt = (b as any).createdAt;
  if (typeof createdAt === "number") return createdAt;
  if (createdAt && typeof createdAt.toMillis === "function") {
    return createdAt.toMillis();
  }

  return 0;
}

function compareBookings(a: Booking, b: Booking, mode: SortMode): number {
  if (mode === "id") {
    const idA = (a.shortId || a.id || "").toString();
    const idB = (b.shortId || b.id || "").toString();
    return idA.localeCompare(idB);
  }

  if (mode === "cost") {
    const ta = clientDisplayTotal(a) ?? 0;
    const tb = clientDisplayTotal(b) ?? 0;
    // sort high → low
    return tb - ta;
  }

  const ta = bookingTimeValue(a);
  const tb = bookingTimeValue(b);

  if (mode === "oldest") {
    return ta - tb; // old → new
  }

  // default: newest
  return tb - ta; // new → old
}

/* ---------- Component ---------- */

export default function ClientBookings() {
  const [user] = useAuthState(auth);
  const router = useRouter();

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

  // 🔽 sorting state
  const [sortMode, setSortMode] = useState<SortMode>("newest");
  const [sortMenuOpen, setSortMenuOpen] = useState(false);

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

  // derived sorted arrays
  const sortedActive = useMemo(
    () => [...active].sort((a, b) => compareBookings(a, b, sortMode)),
    [active, sortMode],
  );

  const sortedCompleted = useMemo(
    () => [...completed].sort((a, b) => compareBookings(a, b, sortMode)),
    [completed, sortMode],
  );

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
      const cancelIdToken = await auth.currentUser?.getIdToken();
      const res = await fetch("/api/cancel-booking", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(cancelIdToken ? { Authorization: `Bearer ${cancelIdToken}` } : {}),
        },
        body: JSON.stringify({
          bookingId: id,
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
    if (booking.date) setNewDate(parseBookingDate(booking.date));
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

      // ✅ store rescheduled date as local "YYYY-MM-DD"
      const newDateISO = dateToISO(newDate);

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
          } rescheduled to ${displayDate(newDateISO)} at ${newTime}.`,
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
    if (p.businessLocationType === "mobile_only") {
      return "Mobile service — comes to your location";
    }
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
    if (!p || p.businessLocationType === "mobile_only") return "";
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

  // 💬 start or open conversation with a provider
  const startConversationWithProvider = async (providerId: string) => {
    if (!user) {
      alert("Please sign in to send a message.");
      router.push("/login");
      return;
    }
    if (!providerId) return;
    if (user.uid === providerId) {
      alert("You can't message yourself.");
      return;
    }

    try {
      const convSnap = await getDocs(
        query(
          collection(db, "conversations"),
          where("participants", "array-contains", user.uid),
        ),
      );

      let existingId: string | null = null;
      convSnap.forEach((docSnap) => {
        const data = docSnap.data() as { participants?: string[] };
        if (data.participants?.includes(providerId)) {
          existingId = docSnap.id;
        }
      });

      let conversationId: string;
      if (existingId) {
        conversationId = existingId;
      } else {
        const newConvRef = await addDoc(collection(db, "conversations"), {
          participants: [user.uid, providerId],
          createdAt: serverTimestamp(),
        });
        conversationId = newConvRef.id;
      }

      router.push(`/messages?conversationId=${conversationId}`);
    } catch (err) {
      console.error("start conversation error", err);
      alert("Could not open chat. Please try again.");
    }
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

    // 💰 compute what the client paid (with markup)
    const totalPaid = clientDisplayTotal(b);

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
              <strong>Date:</strong> {displayDate(b.date)}
            </p>
            <p>
              <strong>Time:</strong> {b.time || "-"}
            </p>
            <p>
              <strong>Total Paid:</strong>{" "}
              {totalPaid !== null ? `KSHS ${totalPaid}` : "—"}
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
                      <button
                        type="button"
                        onClick={() =>
                          startConversationWithProvider(b.providerId!)
                        }
                        className="px-3 py-1 rounded-full border border-gray-300 text-xs font-medium text-gray-700 hover:bg-gray-100"
                      >
                        Message
                      </button>
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
              {b.serviceLocationType === "housecall" ? (
                <p className="text-sm">
                  <strong>Housecall:</strong> the provider will come to{" "}
                  {b.housecallAddress || "the address you provided"}.
                </p>
              ) : (
                <>
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
                </>
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
      {/* Header + sort control */}
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-2xl font-bold">My Bookings</h1>

        <div className="relative">
          <button
            type="button"
            className="flex items-center gap-1 text-gray-600 hover:text-gray-900"
            onClick={() => setSortMenuOpen((v) => !v)}
            aria-label="Sort bookings"
          >
            <FaSortAmountDownAlt />
            <span className="text-sm hidden sm:inline">
              Sort
              {sortMode === "newest" && " (Newest → Oldest)"}
              {sortMode === "oldest" && " (Oldest → Newest)"}
              {sortMode === "id" && " (Booking ID)"}
              {sortMode === "cost" && " (Cost)"}
            </span>
          </button>

          {sortMenuOpen && (
            <div className="absolute right-0 mt-2 w-48 bg-white border rounded shadow-lg z-10 text-sm">
              <button
                className="block w-full text-left px-3 py-2 hover:bg-gray-100"
                onClick={() => {
                  setSortMode("newest");
                  setSortMenuOpen(false);
                }}
              >
                Newest → Oldest
              </button>
              <button
                className="block w-full text-left px-3 py-2 hover:bg-gray-100"
                onClick={() => {
                  setSortMode("oldest");
                  setSortMenuOpen(false);
                }}
              >
                Oldest → Newest
              </button>
              <button
                className="block w-full text-left px-3 py-2 hover:bg-gray-100"
                onClick={() => {
                  setSortMode("id");
                  setSortMenuOpen(false);
                }}
              >
                Booking ID
              </button>
              <button
                className="block w-full text-left px-3 py-2 hover:bg-gray-100"
                onClick={() => {
                  setSortMode("cost");
                  setSortMenuOpen(false);
                }}
              >
                Total Cost
              </button>
            </div>
          )}
        </div>
      </div>

      <section className="mb-6">
        <h2 className="text-xl">Active / Pending</h2>
        {sortedActive.map((b) => (
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
        {sortedActive.length === 0 && (
          <p className="text-sm text-gray-600 mt-2">No active bookings.</p>
        )}
      </section>

      <section>
        <h2 className="text-xl">Completed & Past</h2>
        {sortedCompleted.map((b) => (
          <BookingCard key={b.id} b={b} />
        ))}
        {sortedCompleted.length === 0 && (
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