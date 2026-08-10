"use client";

import { useEffect, useMemo, useState } from "react";
import {
  collection,
  query,
  where,
  getDocs,
  updateDoc,
  doc,
  getDoc,
} from "firebase/firestore";
import { db, auth } from "@/lib/firebase";
import { useAuthState } from "react-firebase-hooks/auth";
import { FaWhatsapp, FaPhoneAlt } from "react-icons/fa";
import Calendar from "react-calendar";
import "react-calendar/dist/Calendar.css";
import MessageButton from "@/components/MessageButton";

interface Booking {
  id: string;
  clientId: string;
  providerId: string;
  videoId?: string;
  date: string;
  time: string;
  total: number; // client-charged total (includes markup)
  status: string;
  addons?: Record<string, number>;
  clientPhone?: string;
  providerPhone?: string;
  clientName?: string;
  shortId?: string;
  completionPin?: string; // optional, not usually visible to provider
  releaseVerified?: boolean; // true when PIN was successfully verified

  // optional pricing fields that may exist on the booking doc
  subtotal?: number; // provider base (service + addons, before markup)
  providerAmount?: number; // if confirm-booking stored it
  markupRate?: number; // fraction like 0.1 for 10%
  markupAmount?: number; // absolute fee amount
  // in future we may also use platformFee

  // ⭐ client note
  clientInstructions?: string;
}

interface Video {
  title?: string;
  details?: string;
  thumbnailUrl?: string;
  imageUrl?: string;
  url?: string;
}

interface UserProfile {
  fullName?: string;
  name?: string;
  location?: string;
  building?: string;
  room?: string;

  // phones
  phone?: string;
  businessPhone?: string;
}

// Helper to normalize date strings into YYYY-MM-DD keys
function dateKey(raw: string | Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");

  if (raw instanceof Date) {
    if (isNaN(raw.getTime())) return "";
    return `${raw.getFullYear()}-${pad(raw.getMonth() + 1)}-${pad(
      raw.getDate(),
    )}`;
  }

  if (typeof raw === "string") {
    // Already normalized
    if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;

    const d = new Date(raw);
    if (isNaN(d.getTime())) return "";
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }

  return "";
}

// Helper to safely display a date (no UTC shifting issues)
function displayDate(raw?: string | Date): string {
  if (!raw) return "-";
  try {
    let d: Date;
    if (raw instanceof Date) {
      d = raw;
    } else if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
      const [y, m, day] = raw.split("-").map((x) => parseInt(x, 10));
      d = new Date(y, (m || 1) - 1, day || 1); // local midnight
    } else {
      d = new Date(raw);
    }
    if (isNaN(d.getTime())) return "-";
    return d.toLocaleDateString();
  } catch {
    return "-";
  }
}

// Helper to compute provider-facing amount (without markup)
function providerDisplayAmount(b: Booking): number {
  // 1) Explicit base/provider fields first
  const explicit = Number(
    b.providerAmount ??
      b.subtotal ??
      (b as any).baseTotal ??
      (b as any).subtotalBeforeMarkup ??
      (b as any).basePrice,
  );
  if (!isNaN(explicit) && explicit > 0) {
    return Math.round(explicit * 100) / 100;
  }

  const total = Number(b.total) || 0;
  if (total <= 0) return 0;

  // 2) If we know an explicit fee amount, infer provider share from difference
  const feeLikeKeys = ["platformFee", "markupAmount"] as const;
  for (const key of feeLikeKeys) {
    const fee = Number((b as any)[key]);
    if (!isNaN(fee) && fee > 0 && fee < total) {
      const implied = total - fee;
      if (implied > 0) {
        return Math.round(implied * 100) / 100;
      }
    }
  }

  // 3) If we know the markupRate as a fraction, reverse it
  if (!isNaN(Number(b.markupRate))) {
    const rate = Number(b.markupRate);
    if (rate > 0 && rate < 1) {
      const implied = total / (1 + rate);
      if (implied > 0) {
        return Math.round(implied * 100) / 100;
      }
    }
  }

  // 4) Last resort: assume provider gets the full total (display-only approximation)
  return Math.round(total * 100) / 100;
}

type ViewMode = "calendar" | "today" | "all" | "delivered";

export default function CreatorBookings() {
  const [user] = useAuthState(auth);
  const [bookings, setBookings] = useState<
    (Booking & { video?: Video; client?: UserProfile; provider?: UserProfile })[]
  >([]);

  const [searchTerm, setSearchTerm] = useState("");
  const [view, setView] = useState<ViewMode>("calendar");

  // 🔐 PIN entry + verification state (per booking)
  const [pinInputs, setPinInputs] = useState<Record<string, string>>({});
  const [verifyingId, setVerifyingId] = useState<string | null>(null);
  const [verifyMessages, setVerifyMessages] = useState<
    Record<string, string | null>
  >({});

  const [selectedDate, setSelectedDate] = useState<Date | null>(new Date());

  useEffect(() => {
    if (!user) return;

    (async () => {
      const qy = query(
        collection(db, "bookings"),
        where("providerId", "==", user.uid),
      );
      const snap = await getDocs(qy);

      const data = await Promise.all(
        snap.docs.map(async (d) => {
          const booking = { id: d.id, ...d.data() } as Booking;
          let video: Video | undefined;
          let client: UserProfile | undefined;
          let provider: UserProfile | undefined;

          if (booking.videoId) {
            const videoSnap = await getDoc(doc(db, "videos", booking.videoId));
            if (videoSnap.exists()) {
              const vd = videoSnap.data() as Video & {
                url?: string;
                description?: string;
              };
              video = {
                title: vd.title,
                details: vd.details ?? (vd as any).description,
                thumbnailUrl: vd.thumbnailUrl,
                imageUrl: vd.imageUrl,
                url: vd.url,
              };
            }
          }

          if (booking.clientId) {
            const clientSnap = await getDoc(doc(db, "users", booking.clientId));
            if (clientSnap.exists()) client = clientSnap.data() as UserProfile;
          }

          if (booking.providerId) {
            const providerSnap = await getDoc(
              doc(db, "users", booking.providerId),
            );
            if (providerSnap.exists())
              provider = providerSnap.data() as UserProfile;
          }

          return { ...booking, video, client, provider };
        }),
      );

      setBookings(data);
    })();
  }, [user]);

  const sendClientSMS = async (
    booking: Booking & { client?: UserProfile; provider?: UserProfile },
  ) => {
    const clientDisplayName =
      booking.client?.fullName || booking.client?.name;
    if (!clientDisplayName || !booking.clientPhone) return;

    const dateStr = displayDate(booking.date);
    const timeStr = booking.time;
    const providerName =
      booking.provider?.name ||
      booking.provider?.fullName ||
      "Service Provider";
    const locationDetails = `${booking.provider?.location || ""} ${
      booking.provider?.building || ""
    } ${booking.provider?.room || ""}`.trim();
    const mapsLink = booking.provider?.location
      ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
          booking.provider.location,
        )}`
      : "";

    const message =
      booking.status === "accepted"
        ? `Hi ${clientDisplayName}, your booking #${
            booking.shortId || booking.id
          } has been ACCEPTED by ${providerName} for ${dateStr} at ${timeStr}. Location: ${locationDetails}. Map: ${mapsLink}`
        : `Hi ${clientDisplayName}, your booking #${
            booking.shortId || booking.id
          } has been REJECTED by ${providerName}.`;

    await fetch("/api/send-sms", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ to: booking.clientPhone, message }),
    });
  };

  const updateStatus = async (
    id: string,
    status: "accepted" | "rejected" | "completed",
  ) => {
    const booking = bookings.find((b) => b.id === id);
    if (!booking) return;

    // ❌ Rejection → handled centrally via /api/reject-booking
    if (status === "rejected") {
      try {
        const rejectIdToken = await auth.currentUser?.getIdToken();
        const res = await fetch("/api/reject-booking", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(rejectIdToken ? { Authorization: `Bearer ${rejectIdToken}` } : {}),
          },
          body: JSON.stringify({
            bookingId: id,
          }),
        });

        const data = await res.json();
        if (!res.ok) {
          throw new Error(data.error || "Failed to reject booking");
        }

        // Update local state
        setBookings((prev) =>
          prev.map((b) =>
            b.id === id ? { ...b, status: "rejected" } : b,
          ),
        );

        // SMS to client (same as before)
        await sendClientSMS({ ...booking, status: "rejected" });
      } catch (err: any) {
        console.error("reject booking error:", err);
        alert(err.message || "Could not reject booking. Try again.");
      }
      return;
    }

    // ✅ accepted / completed still updated client-side
    await updateDoc(doc(db, "bookings", id), { status });
    setBookings((prev) =>
      prev.map((b) => (b.id === id ? { ...b, status } : b)),
    );

    if (status === "accepted") {
      await sendClientSMS({ ...booking, status: "accepted" });
    }
  };

  // 🔐 handle verifying the client's Service Release PIN
  const handleVerifyPin = async (
    booking: Booking & { client?: UserProfile; provider?: UserProfile },
  ) => {
    const pin = (pinInputs[booking.id] || "").trim();
    if (!pin) {
      setVerifyMessages((prev) => ({
        ...prev,
        [booking.id]: "Please enter the PIN provided by the client.",
      }));
      return;
    }

    try {
      setVerifyingId(booking.id);
      setVerifyMessages((prev) => ({ ...prev, [booking.id]: null }));

      const res = await fetch("/api/verify-completion", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          bookingId: booking.id,
          pin,
          providerId: booking.providerId,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Failed to verify PIN");
      }

      // ✅ PIN = service delivered. Mark as completed and releaseVerified locally.
      setBookings((prev) =>
        prev.map((b) =>
          b.id === booking.id
            ? { ...b, status: "completed", releaseVerified: true }
            : b,
        ),
      );
      setVerifyMessages((prev) => ({
        ...prev,
        [booking.id]:
          "PIN verified. Service marked as delivered and funds for this booking will reflect in your available balance.",
      }));
      setPinInputs((prev) => ({ ...prev, [booking.id]: "" }));
    } catch (err: any) {
      setVerifyMessages((prev) => ({
        ...prev,
        [booking.id]:
          err.message || "Could not verify PIN. Check and try again.",
      }));
    } finally {
      setVerifyingId(null);
    }
  };

  // ---------- Search + filtering helpers ----------
  const norm = (s?: string) => (s || "").toLowerCase().trim();
  const needle = norm(searchTerm);

  const allFiltered = useMemo(() => {
    if (!needle) return bookings;
    return bookings.filter((b) => {
      const hay = [
        b.shortId,
        b.id,
        b.client?.fullName,
        b.client?.name,
        b.clientName,
      ].map(norm);
      return hay.some((h) => h.includes(needle));
    });
  }, [bookings, needle]);

  const todayIso = dateKey(new Date());

  const todayFiltered = useMemo(
    () => allFiltered.filter((b) => dateKey(b.date) === todayIso),
    [allFiltered, todayIso],
  );

  const selectedDateKey =
    selectedDate && !isNaN(selectedDate.getTime())
      ? dateKey(selectedDate)
      : "";

  // All bookings for selected date (for main calendar view)
  const selectedDayFiltered = useMemo(
    () =>
      selectedDateKey
        ? allFiltered.filter((b) => dateKey(b.date) === selectedDateKey)
        : [],
    [allFiltered, selectedDateKey],
  );

  // Completed-only set (for delivered calendar)
  const completedFiltered = useMemo(
    () => allFiltered.filter((b) => b.status === "completed"),
    [allFiltered],
  );

  const selectedCompletedFiltered = useMemo(
    () =>
      selectedDateKey
        ? completedFiltered.filter((b) => dateKey(b.date) === selectedDateKey)
        : [],
    [completedFiltered, selectedDateKey],
  );

  // For calendar badges: count of bookings by date (respecting search)
  const bookingsByDate = useMemo(() => {
    const map: Record<string, number> = {};
    allFiltered.forEach((b) => {
      const key = dateKey(b.date);
      if (!key) return;
      map[key] = (map[key] || 0) + 1;
    });
    return map;
  }, [allFiltered]);

  // For delivered calendar: count of completed bookings by date
  const completedByDate = useMemo(() => {
    const map: Record<string, number> = {};
    completedFiltered.forEach((b) => {
      const key = dateKey(b.date);
      if (!key) return;
      map[key] = (map[key] || 0) + 1;
    });
    return map;
  }, [completedFiltered]);

  // tel & WhatsApp helpers
  const telHref = (n?: string) => (n ? `tel:${n.replace(/\s+/g, "")}` : "");
  const waHref = (n?: string) => {
    if (!n) return "";
    const digits = n.replace(/[^\d]/g, "");
    return digits ? `https://wa.me/${digits}` : "";
  };

  const renderBookingCard = (
    b: Booking & { video?: Video; client?: UserProfile; provider?: UserProfile },
  ) => {
    const clientNumber = b.clientPhone || b.client?.phone;

    const providerAmount = providerDisplayAmount(b);

    // Show PIN section for accepted bookings (this is now the only way to complete)
    const showPinSection = b.status === "accepted";

    return (
      <div key={b.id} className="border p-4 mb-4 rounded shadow">
        <div className="grid grid-cols-1 md:grid-cols-5 gap-4 items-start">
          <div className="md:col-span-3">
            {b.video && (
              <>
                <h2 className="text-lg font-semibold">{b.video.title}</h2>
                {b.video.details && (
                  <p className="text-gray-700">{b.video.details}</p>
                )}
              </>
            )}

            <p className="mt-2">
              <strong>Booking ID:</strong> {b.shortId || b.id}
            </p>
            <p>
              <strong>Client:</strong>{" "}
              {b.client?.fullName || b.client?.name || b.clientId}
            </p>

            {/* Client phone with icons + message button */}
            <div className="mt-2 space-y-1 text-sm">
              {clientNumber && (
                <div className="flex flex-wrap items-center gap-2">
                  <a
                    className="inline-flex items-center justify-center w-8 h-8 rounded-full bg-blue-50 hover:bg-blue-100"
                    href={telHref(clientNumber)}
                    title="Call client"
                    aria-label="Call client"
                  >
                    <FaPhoneAlt className="text-blue-600" />
                  </a>
                  {waHref(clientNumber) && (
                    <a
                      className="inline-flex items-center justify-center w-8 h-8 rounded-full bg-green-50 hover:bg-green-100"
                      href={waHref(clientNumber)}
                      target="_blank"
                      rel="noopener noreferrer"
                      title="WhatsApp client"
                      aria-label="WhatsApp client"
                    >
                      <FaWhatsapp className="text-green-600" />
                    </a>
                  )}
                  <span className="text-gray-800">{clientNumber}</span>

                  {/* 💬 Message client on-platform */}
                  {user && b.clientId && (
                    <div className="ml-2">
                      <MessageButton
                        otherUserId={b.clientId}
                        redirectToList
                      />
                    </div>
                  )}
                </div>
              )}
            </div>

            <p className="mt-2">
              <strong>Date:</strong>{" "}
              {displayDate(b.date)}
            </p>
            <p>
              <strong>Time:</strong> {b.time}
            </p>

            {/* ✅ Provider-facing amount (no markup) */}
            <p className="mt-1">
              <strong>Your amount for this booking:</strong> KSHS{" "}
              {providerAmount}
            </p>

            {/* ⭐ Client's special instructions */}
            {b.clientInstructions && (
              <div className="mt-2 p-2 rounded bg-amber-50 border border-amber-100 text-xs text-gray-800 whitespace-pre-wrap">
                <span className="font-semibold">Client instructions:</span>{" "}
                {b.clientInstructions}
              </div>
            )}

            {b.addons && Object.keys(b.addons).length > 0 && (
              <div className="mt-2">
                <strong>Add-ons:</strong>
                <ul className="list-disc list-inside">
                  {Object.entries(b.addons).map(([name, qty]) => (
                    <li key={name}>
                      {name} × {qty}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <p className="mt-2">
              <strong>Status:</strong> {b.status}
            </p>

            {b.status === "pending" && (
              <div className="flex space-x-2 mt-3">
                <button
                  onClick={() => updateStatus(b.id, "accepted")}
                  className="bg-green-500 text-white px-3 py-1 rounded"
                >
                  Accept
                </button>
                <button
                  onClick={() => updateStatus(b.id, "rejected")}
                  className="bg-red-500 text-white px-3 py-1 rounded"
                >
                  Reject
                </button>
              </div>
            )}

            {/* 🔐 Service Release PIN entry (only control to mark delivered) */}
            {showPinSection && (
              <div className="mt-4 border-t pt-3">
                <label className="block text-sm font-medium mb-1">
                  Client&apos;s Service Release PIN
                </label>
                <input
                  type="text"
                  maxLength={4}
                  value={pinInputs[b.id] || ""}
                  onChange={(e) =>
                    setPinInputs((prev) => ({
                      ...prev,
                      [b.id]: e.target.value,
                    }))
                  }
                  placeholder="e.g. 4832"
                  className="border rounded px-2 py-1 text-sm w-40"
                />
                <button
                  onClick={() => handleVerifyPin(b)}
                  disabled={
                    verifyingId === b.id || !(pinInputs[b.id] || "").trim()
                  }
                  className="ml-2 px-3 py-1 rounded bg-green-600 text-white text-sm disabled:bg-gray-400"
                >
                  {verifyingId === b.id
                    ? "Verifying…"
                    : "Verify PIN & Mark Delivered"}
                </button>
                <p className="text-xs text-gray-600 mt-1">
                  After you have delivered the service, ask the client for
                  their Service Release PIN and enter it here. This will mark
                  the service as delivered and allow the funds to reflect in
                  your account.
                </p>
                {b.releaseVerified && (
                  <p className="text-xs text-green-600 mt-1">
                    PIN already verified. Service marked as delivered and funds
                    for this booking are eligible in your available balance.
                  </p>
                )}
                {verifyMessages[b.id] && (
                  <p className="text-xs mt-1 text-gray-700">
                    {verifyMessages[b.id]}
                  </p>
                )}
              </div>
            )}
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

  // ---------- Lists for each view ----------

  const allFilteredList = allFiltered;
  const todayList = todayFiltered;
  const selectedDayList = selectedDayFiltered;
  const selectedCompletedList = selectedCompletedFiltered;

  const currentList =
    view === "today"
      ? todayList
      : view === "calendar"
      ? selectedDayList
      : view === "delivered"
      ? selectedCompletedList
      : allFilteredList;

  return (
    <div className="p-6">
      {/* Header + tabs + search */}
      <div className="mb-4 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <h1 className="text-2xl font-bold">Client Appointments</h1>

        <div className="flex flex-col md:flex-row md:items-center gap-2 w-full md:w-auto">
          {/* Pill toggles */}
          <div className="inline-flex rounded-full bg-gray-100 p-1 w-full md:w-auto">
            {(
              [
                { id: "calendar", label: "Calendar (All)" },
                { id: "delivered", label: "Calendar (Delivered)" },
                { id: "today", label: "Today's Bookings" },
                { id: "all", label: "All Bookings" },
              ] as { id: ViewMode; label: string }[]
            ).map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setView(tab.id)}
                className={`flex-1 md:flex-none px-3 py-1.5 text-xs sm:text-sm rounded-full transition ${
                  view === tab.id
                    ? "bg-white shadow text-gray-900"
                    : "text-gray-600"
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {/* Search input */}
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="Search by booking ID or client name"
            className="w-full md:w-64 border rounded-full px-3 py-2 text-sm"
          />
        </div>
      </div>

      {/* Calendar views (all vs delivered) */}
      {(view === "calendar" || view === "delivered") && (
        <div className="mb-6 grid gap-4 lg:grid-cols-[minmax(260px,320px),1fr]">
          <div className="bg-white rounded-lg shadow p-3 flex justify-center">
            <Calendar
              value={selectedDate}
              onChange={(d) => setSelectedDate(d as Date)}
              tileContent={({ date, view: calView }) => {
                if (calView !== "month") return null;

                const key = dateKey(date);
                const countsMap =
                  view === "calendar" ? bookingsByDate : completedByDate;
                const count = countsMap[key] || 0;

                if (!count) return null;
                return (
                  <div className="mt-1 flex justify-center">
                    <span className="inline-flex items-center justify-center rounded-full bg-[#0F7A5F] text-white text-[10px] min-w-[18px] h-[18px]">
                      {count}
                    </span>
                  </div>
                );
              }}
            />
          </div>

          <div>
            <h2 className="text-lg font-semibold mb-2">
              {view === "calendar" ? "Bookings on " : "Delivered bookings on "}
              {selectedDateKey
                ? displayDate(selectedDateKey)
                : "selected day"}
            </h2>
            {currentList.length === 0 ? (
              <p className="text-sm text-gray-600">
                {view === "calendar"
                  ? "No bookings for this day (matching current search)."
                  : "No delivered bookings for this day (matching current search)."}
              </p>
            ) : (
              currentList.map(renderBookingCard)
            )}
          </div>
        </div>
      )}

      {/* Today / All views */}
      {view !== "calendar" && view !== "delivered" && (
        <>
          {currentList.length === 0 && (
            <p className="text-sm text-gray-600 mb-2">
              {view === "today"
                ? "No bookings for today (matching current search)."
                : "No bookings found."}
            </p>
          )}
          {currentList.map(renderBookingCard)}
        </>
      )}
    </div>
  );
}