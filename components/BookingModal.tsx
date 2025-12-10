// /workspaces/Vext/components/BookingModal.tsx
"use client";

import { useEffect, useRef, useState, useMemo } from "react";
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
  cost: number;
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
  completionPin?: string; // 🔐 PIN for service completion verification
};

type PaymentMethod = "paystack" | "mpesa" | "wallet" | "pesapal" | "";

/* ---------- Markup config (tiered pricing) ---------- */

interface MarkupTier {
  min: number;
  max: number | null; // null = open-ended
  percent: number; // e.g. 10 = 10%
}

interface MarkupConfig {
  tiers: MarkupTier[];
}

// Default tiers if Firestore config is missing:
// 0–1500      → 10%
// 1500–5000   → 5%
// 5000–10000  → 2.5%
// 10000+      → 2%
const DEFAULT_MARKUP_CONFIG: MarkupConfig = {
  tiers: [
    { min: 0, max: 1500, percent: 10 },
    { min: 1500, max: 5000, percent: 5 },
    { min: 5000, max: 10000, percent: 2.5 },
    { min: 10000, max: null, percent: 2 },
  ],
};

function resolveMarkupConfig(config?: MarkupConfig | null): MarkupConfig {
  if (config && Array.isArray(config.tiers) && config.tiers.length > 0) {
    return config;
  }
  return DEFAULT_MARKUP_CONFIG;
}

function getMarkupPercent(basePrice: number, config?: MarkupConfig | null) {
  const cfg = resolveMarkupConfig(config);
  const tier = cfg.tiers.find(
    (t) => basePrice >= t.min && (t.max == null || basePrice <= t.max),
  );
  return tier ? tier.percent : 0;
}

/* ---------- Provider schedule helpers ---------- */
type DayMinutes = { start: number; end: number };
type ScheduleMap = Partial<Record<number, DayMinutes>>;

function hhmmToMin(hhmm: string): number {
  const [h, m] = hhmm.split(":").map((x) => parseInt(x, 10));
  return (h || 0) * 60 + (m || 0);
}
function minToHhmm(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}
function normalizeScheduleFromProfile(profile: any | null): ScheduleMap {
  const out: ScheduleMap = {};
  if (!profile) {
    for (let d of [1, 2, 3, 4, 5, 6]) out[d] = { start: 9 * 60, end: 17 * 60 };
    return out;
  }
  if (profile?.businessHours && typeof profile.businessHours === "object") {
    const obj = profile.businessHours;
    Object.keys(obj).forEach((key) => {
      const di = Number(key);
      const dayIdx = di === 7 ? 0 : di;
      out[dayIdx] = {
        start: hhmmToMin(obj[key]?.start || "09:00"),
        end: hhmmToMin(obj[key]?.end || "17:00"),
      };
    });
    return out;
  }
  if (
    Array.isArray(profile?.operatingDays) &&
    profile?.openTime &&
    profile?.closeTime
  ) {
    const start = hhmmToMin(profile.openTime);
    const end = hhmmToMin(profile.closeTime);
    (profile.operatingDays as number[]).forEach(
      (d) => (out[d] = { start, end }),
    );
    return out;
  }
  if (profile?.hours && typeof profile.hours === "object") {
    const map: Record<string, number> = {
      sun: 0,
      mon: 1,
      tue: 2,
      wed: 3,
      thu: 4,
      fri: 5,
      sat: 6,
    };
    Object.keys(map).forEach((k) => {
      if (profile.hours[k]) {
        out[map[k]] = {
          start: hhmmToMin(profile.hours[k].start || "09:00"),
          end: hhmmToMin(profile.hours[k].end || "17:00"),
        };
      }
    });
    return out;
  }
  for (let d of [1, 2, 3, 4, 5, 6]) out[d] = { start: 9 * 60, end: 17 * 60 };
  return out;
}
function generateSlotsForDate(
  date: Date,
  schedule: ScheduleMap,
  stepMinutes = 60,
): string[] {
  const dayIdx = date.getDay();
  const window = schedule[dayIdx];
  if (!window) return [];
  const out: string[] = [];
  for (let t = window.start; t < window.end; t += stepMinutes)
    out.push(minToHhmm(t));
  return out;
}
function isPastDay(d: Date): boolean {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const cmp = new Date(d);
  cmp.setHours(0, 0, 0, 0);
  return cmp.getTime() < today.getTime();
}
function isTimeInPastToday(hhmm: string): boolean {
  const now = new Date();
  const [hh, mm] = hhmm.split(":").map((x) => parseInt(x, 10));
  const slotDate = new Date();
  slotDate.setHours(hh, mm, 0, 0);
  return slotDate.getTime() <= now.getTime();
}
/* ---------------------------------------------- */

/**
 * Normalize Kenyan Safaricom M-Pesa numbers to 2547XXXXXXXX.
 * Accepts:
 *  - 07XXXXXXXX
 *  - 7XXXXXXXX
 *  - 2547XXXXXXXX
 *  - +2547XXXXXXXX
 */
function normalizeKeMpesaPhone(raw: string) {
  let p = (raw || "").trim();
  if (!p) {
    throw new Error("Enter the M-Pesa phone number");
  }

  // remove spaces
  p = p.replace(/\s+/g, "");

  // strip leading +
  if (p.startsWith("+")) {
    p = p.slice(1);
  }

  // keep only digits
  p = p.replace(/[^\d]/g, "");

  // 07XXXXXXXX (10 digits)
  if (/^07\d{8}$/.test(p)) {
    return "254" + p.slice(1); // 07 -> 2547
  }

  // 7XXXXXXXX (9 digits)
  if (/^7\d{8}$/.test(p)) {
    return "254" + p; // 7 -> 2547
  }

  // 2547XXXXXXXX (12 digits)
  if (/^2547\d{8}$/.test(p)) {
    return p;
  }

  throw new Error(
    "Enter a valid Safaricom number like 07XXXXXXXX, 7XXXXXXXX, 2547XXXXXXXX or +2547XXXXXXXX",
  );
}

export default function BookingModal({ video, onClose }: BookingModalProps) {
  const router = useRouter();
  const [user] = useAuthState(auth);

  const [authOpen, setAuthOpen] = useState(false);
  const [profileComplete, setProfileComplete] = useState(false);
  const [step, setStep] = useState<1 | 2 | 3>(1);

  const [selectedDate, setSelectedDate] = useState<Date>(new Date());
  const [selectedTime, setSelectedTime] = useState<string>("");

  const [addonSelections, setAddonSelections] = useState<
    Record<string, number>
  >({});
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>("");
  const [mpesaPhone, setMpesaPhone] = useState("");
  const [bookedTimes, setBookedTimes] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);

  const [confirmed, setConfirmed] = useState<ConfirmedInfo | null>(null);
  const [lastShortId, setLastShortId] = useState<string | null>(null);

  const [mpesaPending, setMpesaPending] = useState(false);
  const bookingUnsubRef = useRef<Unsubscribe | null>(null);

  const [providerSchedule, setProviderSchedule] = useState<ScheduleMap>({});
  const [awayDates, setAwayDates] = useState<string[]>([]); // 🔴 provider away days (full-day blocks)

  // 🔐 holds the completion PIN from backend for this booking
  const [completionPin, setCompletionPin] = useState<string | null>(null);

  // Markup config (loaded from Firestore)
  const [markupConfig, setMarkupConfig] = useState<MarkupConfig | null>(null);

  // ⭐ client's special instructions for this booking
  const [clientInstructions, setClientInstructions] = useState("");

  // 💰 Wallet balance (client-side view)
  const [walletBalance, setWalletBalance] = useState<number | null>(null);
  const [walletError, setWalletError] = useState<string | null>(null);

  // Pricing
  const base = video.serviceCost || 0;
  const addons = video.addons || [];

  const addonsRawTotal = Object.entries(addonSelections).reduce(
    (sum, [n, qty]) => {
      const addon = addons.find((a) => a.name === n);
      return sum + (addon ? addon.cost * qty : 0);
    },
    0,
  );

  const subtotalRaw = base + addonsRawTotal;

  // Use base price to determine bracket; if base is 0, fall back to subtotal
  const bracketBase = base > 0 ? base : subtotalRaw;
  const markupPercent =
    bracketBase > 0 ? getMarkupPercent(bracketBase, markupConfig) : 0;
  const effectiveMarkupRate = markupPercent / 100;

  const withMarkup = (n: number) => Math.round(n * (1 + effectiveMarkupRate));

  const totalWithMarkup = withMarkup(subtotalRaw);
  const baseForDisplay = withMarkup(base);
  const extrasForDisplay = withMarkup(addonsRawTotal);
  const markupAmount = totalWithMarkup - Math.round(subtotalRaw);

  const specialInstructions = video.specialInstructions || "";
  const includes = video.serviceIncludes || [];
  const notProvided = video.notProvided || [];

  const dateToISO = (d: Date) => d.toISOString().split("T")[0];

  // Load markup config from Firestore (config/pricing)
  useEffect(() => {
    (async () => {
      try {
        const snap = await getDoc(doc(db, "config", "pricing"));
        if (snap.exists()) {
          const data = snap.data() as any;
          if (Array.isArray(data.tiers)) {
            const tiers: MarkupTier[] = data.tiers.map((t: any) => ({
              min: Number(t.min) || 0,
              max:
                typeof t.max === "number"
                  ? t.max
                  : t.max == null
                  ? null
                  : Number(t.max),
              percent: Number(t.percent) || 0,
            }));
            setMarkupConfig({ tiers });
          }
        }
      } catch (err) {
        console.error("load markup config error", err);
      }
    })();
  }, []);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (u) => {
      if (u) {
        setAuthOpen(false);
        const snap = await getDoc(doc(db, "users", u.uid));
        if (snap.exists()) {
          const d = snap.data() as any;
          const hasProfile = !!d.fullName && !!d.phone;
          setProfileComplete(hasProfile);
          setName(d.fullName || "");
          setPhone(d.phone || "");
          setMpesaPhone(d.phone || "");
          setStep(1);
        } else {
          setProfileComplete(false);
          setStep(1);
        }
      } else {
        setProfileComplete(false);
      }
    });
    return () => unsub();
  }, []);

  useEffect(() => {
    if (!user) return;
    getDoc(doc(db, "users", user.uid)).then((snap) => {
      if (!snap.exists()) return;
      const d = snap.data() as any;
      setProfileComplete(!!d.fullName && !!d.phone);
      setName(d.fullName || "");
      setPhone(d.phone || "");
      setMpesaPhone(d.phone || "");
    });
  }, [user]);

  // Provider schedule from profile
  useEffect(() => {
    (async () => {
      if (!video?.userId) return;
      try {
        const ps = await getDoc(doc(db, "users", video.userId));
        const prof = ps.exists() ? (ps.data() as any) : null;
        setProviderSchedule(normalizeScheduleFromProfile(prof));
      } catch {
        setProviderSchedule(normalizeScheduleFromProfile(null));
      }
    })();
  }, [video?.userId]);

  // Provider away days (full-day blocks) from dashboard
  useEffect(() => {
    (async () => {
      if (!video?.userId) return;
      try {
        const snap = await getDocs(
          collection(db, "users", video.userId, "awayDays"),
        );
        const list: string[] = [];
        snap.forEach((d) => {
          const data = d.data() as any;
          list.push(data.date || d.id);
        });
        setAwayDates(list);
      } catch (err) {
        console.error("load provider awayDays error", err);
      }
    })();
  }, [video?.userId]);

  // 🔁 Live-booked times for selected date
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

  // 🔁 Client wallet balance (from walletTransactions)
  useEffect(() => {
    if (!user) {
      setWalletBalance(null);
      return;
    }
    try {
      const txRef = collection(
        db,
        "users",
        user.uid,
        "walletTransactions",
      );
      const unsub = onSnapshot(
        txRef,
        (snap) => {
          let balance = 0;
          snap.forEach((d) => {
            const data = d.data() as any;
            const status = (data.status || "").toLowerCase();
            if (status !== "completed") return;
            const amount = Number(data.amount) || 0;
            const type = (data.type || "credit") as "credit" | "debit";
            balance += type === "credit" ? amount : -amount;
          });
          setWalletBalance(balance);
          setWalletError(null);
        },
        (err) => {
          console.error("wallet balance snapshot error", err);
          setWalletError("Could not load wallet balance.");
        },
      );
      return () => unsub();
    } catch (err) {
      console.error("wallet balance listener error", err);
      setWalletError("Could not load wallet balance.");
    }
  }, [user]);

  useEffect(() => {
    return () => {
      if (bookingUnsubRef.current) {
        bookingUnsubRef.current();
        bookingUnsubRef.current = null;
      }
    };
  }, []);

  const handleProfileSave = async () => {
    if (!user) return alert("You must be signed in");
    if (!name.trim() || !phone) return alert("Name & phone required");
    await updateDoc(doc(db, "users", user.uid), {
      fullName: name.trim(),
      phone,
    });
    setProfileComplete(true);
  };

  const refreshBookedTimes = async () => {
    if (!video?.userId) return;
    const q = collection(db, `availability/${video.userId}/slots`);
    const snap = await getDocs(q);
    const dateStr = selectedDate.toISOString().split("T")[0];
    const times: string[] = [];
    snap.forEach((docSnap) => {
      const data = docSnap.data();
      if (data.date === dateStr && data.booked) times.push(data.time);
    });
    setBookedTimes(times);
  };

  const incAddon = (name: string) =>
    setAddonSelections((p) => ({ ...p, [name]: (p[name] || 0) + 1 }));
  const decAddon = (name: string) =>
    setAddonSelections((p) => {
      const next = { ...p, [name]: Math.max(0, (p[name] || 0) - 1) };
      if (next[name] === 0) delete next[name];
      return next;
    });

  // 🔔 UPDATED: also handle payment_failed so the UI stops spinning on failure
  const waitForBookingConfirmation = (bookingId: string, dateISO: string) => {
    if (bookingUnsubRef.current) {
      bookingUnsubRef.current();
      bookingUnsubRef.current = null;
    }
    const ref = doc(db, "bookings", bookingId);
    bookingUnsubRef.current = onSnapshot(ref, (snap) => {
      if (!snap.exists()) return;
      const data = snap.data() as any;
      const status = (data.status || "").toLowerCase();
      console.log("[BOOKING LISTENER] status:", bookingId, status);

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
          completionPin: completionPin || undefined,
        });
        setStep(3);
      } else if (status === "payment_failed") {
        if (bookingUnsubRef.current) {
          bookingUnsubRef.current();
          bookingUnsubRef.current = null;
        }
        setMpesaPending(false);
        alert(
          "Your M-Pesa payment failed or was cancelled. Please try again.",
        );
      }
    });
  };

  const handlePay = async () => {
    if (!user) {
      setAuthOpen(true);
      return;
    }
    if (!profileComplete) return alert("Please complete your profile");
    if (!paymentMethod) return alert("Select a payment method");

    // 💰 Wallet sanity check before we even save booking
    if (paymentMethod === "wallet") {
      if (walletBalance == null) {
        alert(
          "We couldn't load your wallet balance. Please try again or use another payment method.",
        );
        return;
      }
      if (walletBalance < totalWithMarkup) {
        alert(
          "Your wallet balance is not enough to pay for this booking. Please deposit more or choose another payment method.",
        );
        return;
      }
    }

    try {
      setLoading(true);
      const dateISO = selectedDate.toISOString().split("T")[0];

      const bookingData = {
        clientId: user!.uid,
        providerId: video.userId,
        videoId: video.id || "",
        date: dateISO,
        time: selectedTime,
        subtotal: Math.round(subtotalRaw * 100) / 100,
        total: totalWithMarkup,
        markupRate: effectiveMarkupRate, // fraction, e.g. 0.1
        markupPercent, // for reporting / analytics
        markupAmount, // approx. total markup in KSHS
        addons: addonSelections,
        // ⭐ pass through client-facing info for backend
        clientPhone: phone || null,
        clientName: name || "",
        clientInstructions: clientInstructions.trim() || undefined,
      };

      const saveRes = await fetch("/api/save-booking", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(bookingData),
      });
      const saveData = await saveRes.json();
      if (!saveRes.ok)
        throw new Error(saveData.error || "Failed to save booking");
      const bookingId: string = saveData.bookingId;
      const shortId: string | undefined = saveData.shortId;
      setLastShortId(shortId || null);

      // 🔐 capture completion PIN once from backend
      if (saveData.completionPin) {
        setCompletionPin(saveData.completionPin);
      }

      // 💰 WALLET FLOW — delegate to backend to debit wallet & confirm booking
      if (paymentMethod === "wallet") {
        try {
          const confirmRes = await fetch("/api/confirm-booking", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              bookingId,
              method: "wallet",
              walletPay: true,
            }),
          });
          const confirmData = await confirmRes.json().catch(() => null);
          if (!confirmRes.ok) {
            console.error("wallet confirm error", confirmData);
            throw new Error(
              (confirmData && confirmData.error) ||
                "Wallet payment failed. Please try another method.",
            );
          }

          await refreshBookedTimes();
          setConfirmed({
            bookingId,
            shortId,
            ref: confirmData?.walletTxId || undefined,
            dateISO,
            time: selectedTime,
            total: totalWithMarkup,
            completionPin:
              saveData.completionPin || completionPin || undefined,
          });
          setStep(3);
          return;
        } catch (err: any) {
          console.error("wallet payment error", err);
          alert(
            err?.message ||
              "Wallet payment failed. Your wallet was not charged. Please try again or use another method.",
          );
          return;
        } finally {
          setLoading(false);
        }
      }

      // 💳 PAYSTACK FLOW
      if (paymentMethod === "paystack") {
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
        if (!initRes.ok || !initData?.reference)
          throw new Error(initData?.error || "Payment init failed");

        const PaystackLib = (window as any).PaystackPop;

        // ⚠️ IMPORTANT: Pass a plain function (not async) to Paystack
        const handler = PaystackLib.setup({
          key: process.env.NEXT_PUBLIC_PAYSTACK_KEY!,
          email: user?.email || "noemail@vextup.com",
          amount: Math.round(totalWithMarkup * 100),
          currency: "KES",
          ref: initData.reference,
          metadata: { bookingId },
          callback(response: any) {
            (async () => {
              try {
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
                setConfirmed({
                  bookingId,
                  shortId,
                  ref: response.reference,
                  dateISO,
                  time: selectedTime,
                  total: totalWithMarkup,
                  completionPin:
                    saveData.completionPin || completionPin || undefined,
                });
                setStep(3);
              } catch (err) {
                console.error("Paystack callback error", err);
                alert(
                  "Payment processed, but we could not confirm the booking automatically. Please check your bookings page.",
                );
              }
            })();
          },
          onClose: () => {},
        });
        handler.openIframe();
      }

      // 📲 MPESA FLOW
      if (paymentMethod === "mpesa") {
        if (!mpesaPhone.trim())
          return alert("Please enter the M-Pesa number to charge");
        const msisdn = normalizeKeMpesaPhone(mpesaPhone);
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

        // 🔍 If init fails, stop spinner & surface error
        if (!mpesaRes.ok) {
          setMpesaPending(false);
          const errText = await mpesaRes.text().catch(() => "");
          throw new Error(
            errText || "Failed to start M-Pesa payment. Please try again.",
          );
        }

        await mpesaRes.text();
        waitForBookingConfirmation(bookingId, dateISO);
      }
    } catch (err: any) {
      console.error("❌ Payment error:", err);
      await serverLog({ step: "payError", message: err.message });
      alert(err.message);
    } finally {
      if (paymentMethod !== "wallet") {
        // wallet branch already called setLoading(false) in its own finally
        setLoading(false);
      }
    }
  };

  // Derived slots (respect away days)
  const candidateSlots = useMemo(() => {
    const iso = dateToISO(selectedDate);
    if (awayDates.includes(iso)) {
      // Provider has blocked this day off completely
      return [];
    }
    return generateSlotsForDate(selectedDate, providerSchedule, 60);
  }, [selectedDate, providerSchedule, awayDates]);

  const tileDisabled = ({ date, view }: { date: Date; view: string }) => {
    if (view !== "month") return false;
    if (isPastDay(date)) return true;

    // Provider full-day away blocks from their dashboard
    const iso = dateToISO(date);
    if (awayDates.includes(iso)) return true;

    const slots = generateSlotsForDate(date, providerSchedule, 60);
    if (slots.length === 0) return true;

    const isToday = date.toDateString() === new Date().toDateString();
    const effective = isToday
      ? slots.filter((t) => !isTimeInPastToday(t))
      : slots;
    if (effective.length === 0) return true;

    // Fully-booked indicator only for selected day (we know its bookedTimes)
    const selectedISO = selectedDate.toISOString().split("T")[0];
    const thisISO = date.toISOString().split("T")[0];
    if (thisISO === selectedISO) {
      if (bookedTimes.length >= effective.length) return true;
    }
    return false;
  };

  const walletInsufficient =
    paymentMethod === "wallet" &&
    walletBalance != null &&
    walletBalance < totalWithMarkup;

  return (
    <>
      {/* Overlay: clicking outside closes modal */}
      <div
        className="fixed inset-0 bg-black/60 flex items-center justify-center z-50"
        onClick={onClose}
      >
        {/* Modal card: stop click propagation so inside clicks don't close it */}
        <div
          className="bg-white text-black rounded-lg p-6 w-[90vw] max-w-md shadow-lg relative"
          onClick={(e) => e.stopPropagation()}
        >
          <button
            onClick={onClose}
            className="text-xl absolute top-4 right-4"
            aria-label="Close"
          >
            ×
          </button>

          {/* Logo */}
          <div className="flex justify-center mb-4">
            <img
              src="/vextup-logo.png"
              alt="VEXTUP"
              className="h-20 w-auto object-contain"
            />
          </div>

          {!user ? (
            <div className="text-center p-2">
              <h2 className="text-lg font-bold mb-2">Sign in to Book</h2>
              <p className="text-sm text-gray-700 mb-4">
                You need an account to book this service.
              </p>
              <button
                onClick={() => setAuthOpen(true)}
                className="px-4 py-2 rounded bg-[#0F7A5F] hover:bg-[#0b644e] text-white"
              >
                Sign In / Sign Up
              </button>
            </div>
          ) : (
            <>
              {step === 3 && confirmed ? (
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
                    {confirmed.completionPin && (
                      <p className="mt-2">
                        <strong>Service Release PIN:</strong>{" "}
                        <span className="font-mono tracking-widest">
                          {confirmed.completionPin}
                        </span>
                      </p>
                    )}
                  </div>

                  {confirmed.completionPin && (
                    <p className="text-xs text-gray-500 mb-4">
                      Share this PIN with your provider{" "}
                      <span className="font-semibold">only after</span> you are
                      satisfied the service has been delivered. They will use
                      it to confirm delivery and release funds.
                    </p>
                  )}

                  <div className="flex gap-2 justify-center">
                    <button
                      onClick={() => {
                        onClose();
                        router.push("/bookings");
                      }}
                      className="px-4 py-2 rounded bg-[#0F7A5F] hover:bg-[#0b644e] text-white"
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
              ) : (
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
                        className="w-full bg-[#0F7A5F] hover:bg-[#0b644e] text-white py-2 rounded"
                      >
                        Save & Continue
                      </button>
                    </>
                  ) : step === 1 ? (
                    <>
                      <h2 className="text-lg font-bold mb-3">Book Service</h2>

                      {specialInstructions ? (
                        <div className="mb-3 p-3 rounded bg-emerald-50 border border-emerald-100 text-sm">
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
                          <div className="font-semibold mb-1">
                            Not provided
                          </div>
                          <ul className="list-disc list-inside text-gray-700">
                            {notProvided.map((it, i) => (
                              <li key={i}>{it}</li>
                            ))}
                          </ul>
                        </div>
                      )}

                      {/* Date & time */}
                      <Calendar
                        onChange={(d) => {
                          setSelectedDate(d as Date);
                          setSelectedTime("");
                        }}
                        value={selectedDate}
                        tileDisabled={tileDisabled}
                      />

                      <label className="mt-4 block">Select Time:</label>
                      <select
                        className="w-full border rounded px-2 py-1"
                        value={selectedTime}
                        onChange={(e) => setSelectedTime(e.target.value)}
                      >
                        <option value="">-- time --</option>
                        {candidateSlots.length === 0 && (
                          <option disabled>
                            {awayDates.includes(dateToISO(selectedDate))
                              ? "Provider is away"
                              : "Closed"}
                          </option>
                        )}
                        {candidateSlots.map((t) => {
                          const isBooked = bookedTimes.includes(t);
                          const isPast =
                            selectedDate.toDateString() ===
                              new Date().toDateString() &&
                            isTimeInPastToday(t);
                          const disabled = isBooked || isPast;
                          return (
                            <option key={t} value={t} disabled={disabled}>
                              {t} {isBooked ? "(Booked)" : ""}
                            </option>
                          );
                        })}
                      </select>

                      {/* Price summary */}
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

                      {/* ⭐ Client special instructions to provider */}
                      <div className="mt-4">
                        <label className="block text-sm font-medium mb-1">
                          Special instructions for your provider (optional)
                        </label>
                        <textarea
                          className="w-full border rounded px-2 py-1 text-sm min-h-[80px]"
                          placeholder="E.g. Bring your own tools, call when you arrive, I have allergies, etc."
                          value={clientInstructions}
                          onChange={(e) =>
                            setClientInstructions(e.target.value)
                          }
                        />
                        <p className="text-xs text-gray-500 mt-1">
                          This note will be shared with your provider together
                          with your booking details.
                        </p>
                      </div>

                      <button
                        onClick={() => setStep(2)}
                        disabled={!selectedTime}
                        className="mt-4 w-full bg-[#0F7A5F] hover:bg-[#0b644e] text-white py-2 rounded disabled:bg-gray-400"
                      >
                        Continue
                      </button>
                    </>
                  ) : (
                    <>
                      <h2 className="text-lg font-bold mb-3">
                        Confirm Booking
                      </h2>
                      <p>Date: {selectedDate.toDateString()}</p>
                      <p>Time: {selectedTime}</p>
                      <p className="mt-2 font-semibold">
                        Total: KSHS {totalWithMarkup}
                      </p>

                      {clientInstructions.trim() && (
                        <div className="mt-3 p-2 rounded bg-gray-50 border text-xs text-gray-800 whitespace-pre-wrap">
                          <span className="font-semibold">
                            Your note to the provider:
                          </span>{" "}
                          {clientInstructions}
                        </div>
                      )}

                      <select
                        className="w-full border rounded px-2 py-1 mt-2"
                        value={paymentMethod}
                        onChange={(e) =>
                          setPaymentMethod(e.target.value as PaymentMethod)
                        }
                        disabled={mpesaPending}
                      >
                        <option value="">-- choose --</option>
                        <option value="paystack">
                          Pay with Card (Paystack)
                        </option>
                        <option value="mpesa">Pay with M-Pesa</option>
                        <option
                          value="wallet"
                          disabled={
                            walletBalance == null ||
                            walletBalance <= 0 ||
                            walletBalance < totalWithMarkup
                          }
                        >
                          {walletBalance == null
                            ? "Wallet (loading…)"
                            : `Pay with Wallet (KSH ${walletBalance.toFixed(
                                2,
                              )} available)`}
                        </option>
                      </select>

                      {walletError && (
                        <p className="mt-1 text-xs text-red-600">
                          {walletError}
                        </p>
                      )}
                      {walletBalance != null &&
                        walletBalance < totalWithMarkup && (
                          <p className="mt-1 text-xs text-red-600">
                            Wallet balance is not enough for this booking.
                          </p>
                        )}

                      {paymentMethod === "mpesa" && (
                        <div className="mt-3">
                          <label className="block font-semibold">
                            M-Pesa number to charge
                          </label>
                          <input
                            type="tel"
                            placeholder="07XXXXXXXX or +2547XXXXXXXX"
                            className="w-full border rounded px-2 py-1 mt-2"
                            value={mpesaPhone}
                            onChange={(e) => setMpesaPhone(e.target.value)}
                            disabled={mpesaPending}
                          />
                          <p className="text-xs text-gray-600 mt-1">
                            You can enter 07XXXXXXXX, 7XXXXXXXX, 2547XXXXXXXX
                            or +2547XXXXXXXX. We&apos;ll format it
                            automatically.
                          </p>
                        </div>
                      )}

                      <button
                        onClick={handlePay}
                        disabled={
                          loading ||
                          mpesaPending ||
                          (paymentMethod === "wallet" && walletInsufficient)
                        }
                        className="mt-4 w-full bg-[#0F7A5F] hover:bg-[#0b644e] text-white py-2 rounded disabled:bg-gray-400"
                      >
                        {loading ? "Processing..." : "Proceed to Pay"}
                      </button>

                      {mpesaPending && (
                        <div className="mt-4 p-3 rounded bg-emerald-50 border border-emerald-200 text-sm">
                          <div className="font-semibold mb-1">
                            Waiting for M-Pesa confirmation…
                          </div>
                          <p className="text-gray-700">
                            Approve the STK push on your phone. This screen
                            will update automatically once payment is
                            confirmed.
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
      </div>

      {/* Global auth modal */}
      {authOpen && (
        <AuthModal open={authOpen} onClose={() => setAuthOpen(false)} />
      )}
    </>
  );
}