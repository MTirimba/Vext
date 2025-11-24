"use client";

import { useEffect, useRef, useState } from "react";
import Calendar from "react-calendar";
import "react-calendar/dist/Calendar.css";
import { auth, db } from "../lib/firebase";
import { useAuthState } from "react-firebase-hooks/auth";
import PhoneInput from "react-phone-number-input";
import "react-phone-number-input/style.css";
import {
  getDoc,
  doc,
  updateDoc,
  collection,
  getDocs,
  onSnapshot,
  Unsubscribe,
} from "firebase/firestore";
import { onAuthStateChanged } from "firebase/auth";
import { useRouter } from "next/navigation";
import AuthModal from "./AuthModal";

// Optional: send logs to /api/log (ok if 404)
async function serverLog(data: any) {
  try {
    await fetch("/api/log", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
  } catch {}
}

interface Addon {
  name: string;
  cost: number; // provider's base
  unit: string;
}

interface VideoDoc {
  id?: string;
  userId?: string;

  serviceCost?: number;
  addons?: Addon[];

  specialInstructions?: string | null;
  serviceIncludes?: string[];
  notProvided?: string[];
}

interface BookingModalProps {
  video: VideoDoc;
  onClose: () => void;
}

type ConfirmedInfo = {
  bookingId: string;
  shortId?: string;
  ref?: string;
  dateISO: string;
  time: string;
  total: number;
  serviceTitle?: string;
};

export default function BookingModal({ video, onClose }: BookingModalProps) {
  const router = useRouter();
  const [user] = useAuthState(auth);

  const [authOpen, setAuthOpen] = useState(false);

  const [profileComplete, setProfileComplete] = useState(false);
  const [step, setStep] = useState<1 | 2 | 3>(1); // 3 = confirmation screen
  const [selectedDate, setSelectedDate] = useState<Date>(new Date());
  const [selectedTime, setSelectedTime] = useState<string>("");
  const [addonSelections, setAddonSelections] = useState<Record<string, number>>(
    {}
  );
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [paymentMethod, setPaymentMethod] = useState<
    "paystack" | "mpesa" | "pesapal" | ""
  >("");
  const [mpesaPhone, setMpesaPhone] = useState("");
  const [bookedTimes, setBookedTimes] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);

  const [confirmed, setConfirmed] = useState<ConfirmedInfo | null>(null);

  // Track booking ids for both flows
  const [lastBookingId, setLastBookingId] = useState<string | null>(null);
  const [lastShortId, setLastShortId] = useState<string | null>(null);

  // M-Pesa waiting state and listener
  const [mpesaPending, setMpesaPending] = useState(false);
  const bookingUnsubRef = useRef<Unsubscribe | null>(null);

  // -------------------------------
  // Pricing (no markup disclosure in UI)
  // -------------------------------
  const markupRate = 0.1; // internal math only
  const base = video.serviceCost || 0;
  const addons = video.addons || [];
  const withMarkup = (n: number) => Math.round(n * (1 + markupRate));

  const addonsRawTotal = Object.entries(addonSelections).reduce(
    (sum, [n, qty]) => {
      const addon = addons.find((a) => a.name === n);
      return sum + (addon ? addon.cost * qty : 0);
    },
    0
  );
  const subtotalRaw = base + addonsRawTotal;
  const totalWithMarkup = withMarkup(subtotalRaw);

  const baseForDisplay = withMarkup(base);
  const extrasForDisplay = withMarkup(addonsRawTotal);

  const specialInstructions = video.specialInstructions || "";
  const includes = video.serviceIncludes || [];
  const notProvided = video.notProvided || [];

  // 🔹 Keep the component aware of auth transitions (so we can reopen the booking flow)
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (u) => {
      if (u) {
        // user just signed in — close auth modal and load profile basics
        setAuthOpen(false);
        const snap = await getDoc(doc(db, "users", u.uid));
        if (snap.exists()) {
          const d = snap.data() as any;
          const hasProfile = !!d.fullName && !!d.phone;
          setProfileComplete(hasProfile);
          setName(d.fullName || "");
          setPhone(d.phone || "");
          setMpesaPhone(d.phone || "");
          // push back to step 1 (continue booking)
          setStep(1);
        } else {
          // no profile doc yet
          setProfileComplete(false);
          setStep(1);
        }
      } else {
        // signed out
        setProfileComplete(false);
      }
    });
    return () => unsub();
  }, []);

  // 🔹 Fetch profile (for already-logged-in users)
  useEffect(() => {
    if (!user) return;
    getDoc(doc(db, "users", user.uid)).then((snap) => {
      if (snap.exists()) {
        const d = snap.data() as any;
        setProfileComplete(!!d.fullName && !!d.phone);
        setName(d.fullName || "");
        setPhone(d.phone || "");
        setMpesaPhone(d.phone || "");
      }
    });
  }, [user]);

  // 🔹 Fetch booked times
  useEffect(() => {
    if (!video?.userId || !selectedDate) return;
    const dateStr = selectedDate.toISOString().split("T")[0];
    const q = collection(db, `availability/${video.userId}/slots`);
    const unsub = onSnapshot(q, (snapshot) => {
      const times: string[] = [];
      snapshot.forEach((docSnap) => {
        const data = docSnap.data();
        if (data.date === dateStr && data.booked) times.push(data.time);
      });
      setBookedTimes(times);
    });
    return () => unsub();
  }, [video?.userId, selectedDate]);

  useEffect(() => {
    // cleanup any active booking listener on unmount
    return () => {
      if (bookingUnsubRef.current) {
        bookingUnsubRef.current();
        bookingUnsubRef.current = null;
      }
    };
  }, []);

  const handleProfileSave = async () => {
    if (!user) {
      // Shouldn't happen (we don't show this form if not logged in), but just in case:
      alert("You must be signed in");
      return;
    }
    if (!name.trim() || !phone) return alert("Name & phone required");

    await updateDoc(doc(db, "users", user.uid), {
      fullName: name.trim(),
      phone,
    });
    setProfileComplete(true);
  };

  function normalizeKeMpesaPhone(raw: string) {
    let p = (raw || "").trim();
    if (!p) throw new Error("Please enter phone number");
    p = p.replace(/\s+/g, "");
    if (p.startsWith("+")) p = p.slice(1);
    if (p.startsWith("0")) p = `254${p.slice(1)}`;
    else if (p.startsWith("7")) p = `254${p}`;
    else if (!p.startsWith("254")) throw new Error("Enter valid KE number");
    p = p.replace(/\D/g, "");
    if (!(p.length === 12 && p.startsWith("2547")))
      throw new Error("Invalid Safaricom number");
    return p;
  }

  const refreshBookedTimes = async () => {
    if (!video?.userId) return;
    const q = collection(db, `availability/${video.userId}/slots`);
    const snap = await getDocs(q);
    const times: string[] = [];
    snap.forEach((docSnap) => {
      const data = docSnap.data();
      if (
        data.date === selectedDate.toISOString().split("T")[0] &&
        data.booked
      )
        times.push(data.time);
    });
    setBookedTimes(times);
  };

  // UI controls for extras
  const incAddon = (name: string) =>
    setAddonSelections((p) => ({ ...p, [name]: (p[name] || 0) + 1 }));
  const decAddon = (name: string) =>
    setAddonSelections((p) => {
      const next = { ...p, [name]: Math.max(0, (p[name] || 0) - 1) };
      if (next[name] === 0) delete next[name];
      return next;
    });

  // Start listening to a booking document and transition to confirmation once confirmed
  const waitForBookingConfirmation = (bookingId: string, dateISO: string) => {
    if (bookingUnsubRef.current) {
      bookingUnsubRef.current();
      bookingUnsubRef.current = null;
    }

    const ref = doc(db, "bookings", bookingId);
    bookingUnsubRef.current = onSnapshot(
      ref,
      (snap) => {
        if (!snap.exists()) return;
        const data = snap.data() as any;
        const status = (data.status || "").toLowerCase();
        if (status === "confirmed" || status === "completed") {
          if (bookingUnsubRef.current) {
            bookingUnsubRef.current();
            bookingUnsubRef.current = null;
          }
          setMpesaPending(false);

          setConfirmed({
            bookingId,
            shortId: data.shortId || lastShortId || undefined,
            ref: data.paymentRef || undefined,
            dateISO,
            time: data.time || selectedTime,
            total: data.total || totalWithMarkup,
            serviceTitle: undefined,
          });
          setStep(3);
        }
      },
      (err) => {
        console.error("booking onSnapshot error", err);
      }
    );
  };

  // 🔹 Payment handler
  const handlePay = async () => {
    if (!user) {
      setAuthOpen(true);
      return;
    }
    if (!profileComplete) {
      alert("Please complete your profile");
      return;
    }
    if (!paymentMethod) return alert("Select a payment method");

    const safeLog = async (payload: any) => {
      try {
        await serverLog(payload);
      } catch {}
    };

    try {
      setLoading(true);
      const dateISO = selectedDate.toISOString().split("T")[0];

      const bookingData = {
        clientId: user!.uid,
        providerId: video.userId,
        videoId: video.id || "",
        date: dateISO,
        time: selectedTime,

        subtotal: Math.round(subtotalRaw * 100) / 100, // internal
        total: totalWithMarkup,
        markupRate, // internal only
        markupAmount: totalWithMarkup - Math.round(subtotalRaw),

        addons: addonSelections,
      };

      // Save booking and capture both IDs (docId + shortId)
      const saveRes = await fetch("/api/save-booking", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(bookingData),
      });
      const saveData = await saveRes.json();
      if (!saveRes.ok) throw new Error(saveData.error || "Failed to save booking");
      const bookingId: string = saveData.bookingId;
      const shortId: string | undefined = saveData.shortId;

      setLastBookingId(bookingId);
      setLastShortId(shortId || null);

      // ✅ PAYSTACK
      if (paymentMethod === "paystack") {
        await safeLog({
          step: "startPaystack",
          total: totalWithMarkup,
          bookingId,
        });

        const ensurePaystackReady = () =>
          new Promise<void>((resolve, reject) => {
            if ((window as any).PaystackPop?.setup) return resolve();
            const s = document.createElement("script");
            s.src = "https://js.paystack.co/v1/inline.js";
            s.async = true;
            s.onload = () => {
              const check = setInterval(() => {
                if ((window as any).PaystackPop?.setup) {
                  clearInterval(check);
                  resolve();
                }
              }, 150);
            };
            s.onerror = () => reject(new Error("Failed to load Paystack"));
            document.body.appendChild(s);
          });

        await ensurePaystackReady();
        await safeLog({ step: "paystackLoaded" });

        // Initialize reference on server
        const initRes = await fetch("/api/paystack/init", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            email: user?.email || "noemail@vextup.com",
            amount: totalWithMarkup,
            metadata: { bookingId },
          }),
        });
        const initData = await initRes.json();
        if (!initRes.ok || !initData?.reference) {
          throw new Error(initData?.error || "Payment init failed");
        }

        const PaystackLib = (window as any).PaystackPop;
        const publicKey = process.env.NEXT_PUBLIC_PAYSTACK_KEY;
        if (!PaystackLib?.setup || !publicKey) {
          throw new Error("Paystack configuration missing");
        }

        const onCallback = (response: any) => {
          (async () => {
            await safeLog({ event: "paystackSuccess", response });
            await fetch("/api/confirm-booking", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                bookingId,
                paymentRef: response.reference,
                method: "paystack",
              }),
            });
            await refreshBookedTimes();

            // Transition to confirmation view (shortId included)
            setConfirmed({
              bookingId,
              shortId: shortId || undefined,
              ref: response.reference,
              dateISO,
              time: selectedTime,
              total: totalWithMarkup,
              serviceTitle: undefined,
            });
            setStep(3);
          })().catch((e) => {
            console.error("Callback post-processing failed:", e);
            alert("Payment succeeded but post-processing failed. Please refresh.");
          });
        };

        const onClose = () => {
          // user closed the iframe
        };

        const handler = PaystackLib.setup({
          key: publicKey,
          email: user?.email || "noemail@vextup.com",
          amount: Math.round(totalWithMarkup * 100), // minor units
          currency: "KES",
          ref: initData.reference,
          metadata: { bookingId },
          callback: onCallback,
          onClose,
        });

        await safeLog({ step: "openIframe", ref: initData.reference });
        handler.openIframe();
      }

      // ✅ M-PESA
      if (paymentMethod === "mpesa") {
        if (!mpesaPhone.trim())
          return alert("Please enter the M-Pesa number to charge");
        const msisdn = normalizeKeMpesaPhone(mpesaPhone);
        await safeLog({ step: "mpesaStart", msisdn, total: totalWithMarkup, bookingId });

        // Start waiting overlay *before* calling init
        setMpesaPending(true);

        const mpesaRes = await fetch("/api/mpesa/init", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            phoneNumber: msisdn,
            amount: totalWithMarkup,
            bookingId,
          }),
        });

        const respText = await mpesaRes.text();
        await safeLog({ step: "mpesaResponse", raw: respText, bookingId });

        // Start listening for booking confirmation in Firestore
        waitForBookingConfirmation(bookingId, dateISO);
      }
    } catch (err: any) {
      console.error("❌ Payment error:", err);
      await serverLog({ step: "payError", message: err.message });
      alert(err.message);
    } finally {
      setLoading(false);
    }
  };

  const availableTimes = [
    "09:00",
    "10:00",
    "11:00",
    "12:00",
    "13:00",
    "14:00",
    "15:00",
    "16:00",
    "17:00",
  ];

  // ---------- Render ----------
  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
      <div className="bg-white text-black rounded-lg p-6 w-[90vw] max-w-md shadow-lg relative">
        <button onClick={onClose} className="text-xl absolute top-4 right-4">
          ×
        </button>

        {/* 🔒 If not signed in: show sign-in prompt rather than profile form */}
        {!user ? (
          <div className="text-center p-2">
            <h2 className="text-lg font-bold mb-2">Sign in to Book</h2>
            <p className="text-sm text-gray-700 mb-4">
              You need an account to book this service.
            </p>
            <button
              onClick={() => setAuthOpen(true)}
              className="px-4 py-2 rounded bg-blue-600 text-white"
            >
              Sign In / Sign Up
            </button>

            {authOpen && (
              <AuthModal
                open={authOpen}
                onClose={() => setAuthOpen(false)}
              />
            )}
          </div>
        ) : (
          <>
            {/* STEP 3: Confirmation */}
            {step === 3 && confirmed && (
              <div className="text-center">
                <div className="mx-auto mb-4 w-14 h-14 rounded-full bg-green-100 flex items-center justify-center">
                  <span className="text-2xl">✅</span>
                </div>
                <h2 className="text-xl font-bold mb-2">Booking Confirmed</h2>
                <div className="text-sm text-gray-700 space-y-1 mb-4">
                  {confirmed.shortId ? (
                    <p>
                      <strong>Booking Code:</strong> {confirmed.shortId}
                    </p>
                  ) : (
                    <p>
                      <strong>Booking ID:</strong> {confirmed.bookingId}
                    </p>
                  )}
                  {confirmed.ref && (
                    <p>
                      <strong>Payment Ref:</strong> {confirmed.ref}
                    </p>
                  )}
                  <p>
                    <strong>Date:</strong>{" "}
                    {new Date(confirmed.dateISO).toDateString()}
                  </p>
                  <p>
                    <strong>Time:</strong> {confirmed.time}
                  </p>
                  <p>
                    <strong>Total Paid:</strong> KSHS {confirmed.total}
                  </p>
                </div>

                <div className="flex gap-2 justify-center">
                  <button
                    onClick={() => {
                      onClose();
                      router.push("/bookings");
                    }}
                    className="px-4 py-2 rounded bg-blue-600 text-white"
                  >
                    View My Bookings
                  </button>
                  <button
                    onClick={onClose}
                    className="px-4 py-2 rounded bg-gray-200"
                  >
                    Close
                  </button>
                </div>
              </div>
            )}

            {/* STEP 1 & 2 (only when logged in) */}
            {step !== 3 && (
              <>
                {!profileComplete ? (
                  <>
                    <h2 className="text-lg font-bold mb-3">
                      Complete Your Profile
                    </h2>
                    <label>Full Name</label>
                    <input
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      className="w-full border rounded px-2 py-1 mb-4"
                    />
                    <label>Phone Number</label>
                    <PhoneInput
                      international
                      defaultCountry="KE"
                      value={phone}
                      onChange={(v) => setPhone(v || "")}
                      className="w-full mb-4"
                    />
                    <button
                      onClick={handleProfileSave}
                      className="w-full bg-blue-600 text-white py-2 rounded"
                    >
                      Save & Continue
                    </button>
                  </>
                ) : step === 1 ? (
                  <>
                    <h2 className="text-lg font-bold mb-3">Book Service</h2>

                    {/* Service details (optional) */}
                    {specialInstructions ? (
                      <div className="mb-3 p-3 rounded bg-yellow-50 border border-yellow-200 text-sm">
                        <div className="font-semibold mb-1">
                          Special instructions
                        </div>
                        <p className="text-gray-800 whitespace-pre-wrap">
                          {specialInstructions}
                        </p>
                      </div>
                    ) : null}

                    {includes.length > 0 && (
                      <div className="mb-3 p-3 rounded bg-gray-50 border text-sm">
                        <div className="font-semibold mb-1">Included</div>
                        <ul className="list-disc list-inside text-gray-800">
                          {includes.map((it, i) => (
                            <li key={i}>{it}</li>
                          ))}
                        </ul>
                      </div>
                    )}

                    {notProvided.length > 0 && (
                      <div className="mb-3 p-3 rounded bg-gray-50 border text-sm">
                        <div className="font-semibold mb-1">Not provided</div>
                        <ul className="list-disc list-inside text-gray-700">
                          {notProvided.map((it, i) => (
                            <li key={i}>{it}</li>
                          ))}
                        </ul>
                      </div>
                    )}

                    {/* Extras */}
                    {addons.length > 0 && (
                      <div className="mb-4 p-3 rounded bg-white border text-sm">
                        <div className="font-semibold mb-2">Extras</div>
                        <div className="space-y-2">
                          {addons.map((a) => {
                            const qty = addonSelections[a.name] || 0;
                            const unitPriceCustomer = withMarkup(a.cost);
                            const lineTotal = unitPriceCustomer * qty;
                            return (
                              <div
                                key={a.name}
                                className="flex items-center justify-between"
                              >
                                <div className="min-w-0 pr-2">
                                  <div className="font-medium truncate">
                                    {a.name}
                                  </div>
                                  <div className="text-xs text-gray-600">
                                    {a.unit} • KSHS {unitPriceCustomer}
                                  </div>
                                </div>

                                <div className="flex items-center space-x-2">
                                  <button
                                    type="button"
                                    onClick={() => decAddon(a.name)}
                                    className="px-2 py-1 rounded border"
                                  >
                                    −
                                  </button>
                                  <span className="w-6 text-center">{qty}</span>
                                  <button
                                    type="button"
                                    onClick={() => incAddon(a.name)}
                                    className="px-2 py-1 rounded border"
                                  >
                                    +
                                  </button>
                                  <div className="w-20 text-right tabular-nums">
                                    {qty > 0 ? `KSHS ${lineTotal}` : ""}
                                  </div>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}

                    {/* Date & time */}
                    <Calendar
                      onChange={(d) => setSelectedDate(d as Date)}
                      value={selectedDate}
                    />
                    <label className="mt-4 block">Select Time:</label>
                    <select
                      className="w-full border rounded px-2 py-1"
                      value={selectedTime}
                      onChange={(e) => setSelectedTime(e.target.value)}
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
                        <option
                          key={t}
                          value={t}
                          disabled={bookedTimes.includes(t)}
                        >
                          {t} {bookedTimes.includes(t) ? " (Booked)" : ""}
                        </option>
                      ))}
                    </select>

                    {/* Price summary (no markup disclosure) */}
                    <div className="mt-4 text-sm bg-gray-50 border rounded p-3">
                      <div className="flex justify-between">
                        <span>Base</span>
                        <span className="tabular-nums">
                          KSHS {baseForDisplay}
                        </span>
                      </div>
                      {addonsRawTotal > 0 && (
                        <div className="flex justify-between">
                          <span>Extras</span>
                          <span className="tabular-nums">
                            KSHS {extrasForDisplay}
                          </span>
                        </div>
                      )}
                      <div className="flex justify-between font-semibold mt-1">
                        <span>Total</span>
                        <span className="tabular-nums">
                          KSHS {totalWithMarkup}
                        </span>
                      </div>
                    </div>

                    <button
                      onClick={() => setStep(2)}
                      disabled={!selectedTime}
                      className="mt-4 w-full bg-green-600 text-white py-2 rounded disabled:bg-gray-400"
                    >
                      Continue
                    </button>
                  </>
                ) : (
                  <>
                    <h2 className="text-lg font-bold mb-3">Confirm Booking</h2>
                    <p>Date: {selectedDate.toDateString()}</p>
                    <p>Time: {selectedTime}</p>
                    <p className="mt-2 font-semibold">
                      Total: KSHS {totalWithMarkup}
                    </p>

                    <select
                      className="w-full border rounded px-2 py-1 mt-2"
                      value={paymentMethod}
                      onChange={(e) => setPaymentMethod(e.target.value as any)}
                      disabled={mpesaPending}
                    >
                      <option value="">-- choose --</option>
                      <option value="paystack">Pay with Card (Paystack)</option>
                      <option value="mpesa">Pay with M-Pesa</option>
                    </select>

                    {paymentMethod === "mpesa" && (
                      <div className="mt-3">
                        <label className="block font-semibold">
                          M-Pesa number to charge
                        </label>
                        <input
                          type="tel"
                          placeholder="2547XXXXXXXX"
                          className="w-full border rounded px-2 py-1 mt-2"
                          value={mpesaPhone}
                          onChange={(e) => setMpesaPhone(e.target.value)}
                          disabled={mpesaPending}
                        />
                        <p className="text-xs text-gray-600 mt-1">
                          Use format 2547XXXXXXXX (no + sign)
                        </p>
                      </div>
                    )}

                    <button
                      onClick={handlePay}
                      disabled={loading || mpesaPending}
                      className="mt-4 w-full bg-blue-600 text-white py-2 rounded disabled:bg-gray-400"
                    >
                      {loading ? "Processing..." : "Proceed to Pay"}
                    </button>

                    {/* M-Pesa waiting overlay */}
                    {mpesaPending && (
                      <div className="mt-4 p-3 rounded bg-blue-50 border border-blue-200 text-sm">
                        <div className="font-semibold mb-1">
                          Waiting for M-Pesa confirmation…
                        </div>
                        <p className="text-gray-700">
                          Approve the STK push on your phone. This screen will
                          update automatically once payment is confirmed.
                        </p>
                      </div>
                    )}
                  </>
                )}
              </>
            )}
          </>
        )}
      </div>

      {/* Auth modal lives alongside (for not-logged-in path) */}
      {authOpen && (
        <AuthModal open={authOpen} onClose={() => setAuthOpen(false)} />
      )}
    </div>
  );
}