// /workspaces/Vext/app/provider/dashboard/page.tsx
'use client';

import { useState, useEffect } from 'react';
import { auth, db } from '@/lib/firebase';
import { useAuthState } from 'react-firebase-hooks/auth';
import {
  collection,
  query,
  where,
  onSnapshot,
  doc,
  getDoc,
  getDocs,
  setDoc,
  deleteDoc,
} from 'firebase/firestore';
import Calendar from 'react-calendar';
import 'react-calendar/dist/Calendar.css';
import WithdrawModal from '@/components/WithdrawModal';
import WithdrawalHistory from '@/components/WithdrawalHistory';
import PayoutSettingsModal from '@/components/PayoutSettingsModal';
import { useRouter } from 'next/navigation';

type BookingSummary = {
  total: number;
  pending: number;
  accepted: number;
  confirmed: number;
  completed: number;
  rejected: number;
  cancelled: number;
};

type VideoStat = {
  videoId: string;
  title: string;
  bookings: number;
  likes: number;
};

type ClientStat = {
  clientId: string;
  name: string;
  bookings: number;
};

type AwayDay = {
  date: string; // YYYY-MM-DD
  fullDay?: boolean;
  createdAt?: number;
};

export default function ProviderDashboard() {
  const [user] = useAuthState(auth);
  const router = useRouter();

  // ----- UI tabs -----
  const [activeTab, setActiveTab] = useState<'wallet' | 'stats' | 'availability'>(
    'wallet',
  );

  // ----- wallet state -----
  const [loading, setLoading] = useState(true);
  const [balance, setBalance] = useState(0);
  const [showWithdraw, setShowWithdraw] = useState(false);
  const [showPayoutSettings, setShowPayoutSettings] = useState(false);
  const [hasPayoutSettings, setHasPayoutSettings] = useState<boolean | null>(
    null,
  );

  // Pending payouts (paid but Release PIN not verified yet)
  const [pendingEarnings, setPendingEarnings] = useState(0);
  const [pendingBookings, setPendingBookings] = useState<
    { id: string; [key: string]: any }[]
  >([]);

  // ----- stats state -----
  const [statsLoading, setStatsLoading] = useState(false);
  const [bookingSummary, setBookingSummary] = useState<BookingSummary | null>(
    null,
  );
  const [followersCount, setFollowersCount] = useState<number | null>(null);
  const [videoStats, setVideoStats] = useState<VideoStat[]>([]);
  const [loyalClients, setLoyalClients] = useState<ClientStat[]>([]);
  const [lostRevenue, setLostRevenue] = useState(0); // refunded/lost value

  // ----- availability / away days state -----
  const [awayDates, setAwayDates] = useState<string[]>([]);
  const [availabilityLoading, setAvailabilityLoading] = useState(false);
  const [selectedAvailabilityDate, setSelectedAvailabilityDate] = useState<Date>(
    () => new Date(),
  );

  // ---------- Date helpers (LOCAL, no timezone shift) ----------
  // Convert Date -> "YYYY-MM-DD" based on local calendar day
  const dateToISO = (d: Date) => {
    const year = d.getFullYear();
    const month = `${d.getMonth() + 1}`.padStart(2, '0');
    const day = `${d.getDate()}`.padStart(2, '0');
    return `${year}-${month}-${day}`;
  };

  // Parse "YYYY-MM-DD" into a local Date (no UTC interpretation)
  const parseISODate = (iso: string): Date => {
    const [y, m, d] = iso.split('-').map(Number);
    return new Date(y, m - 1, d);
  };

  const isPastDay = (d: Date) => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const cmp = new Date(d);
    cmp.setHours(0, 0, 0, 0);
    return cmp.getTime() < today.getTime();
  };

  // ✅ Check payout settings
  useEffect(() => {
    if (!user) return;
    const userRef = doc(db, 'users', user.uid);

    getDoc(userRef).then((snap) => {
      if (snap.exists()) {
        const data = snap.data() as any;
        const hasSettings = data.payout_method === 'mpesa' && !!data.payout_phone;
        console.log('[PROVIDER_DASHBOARD] Payout settings loaded:', {
          userId: user.uid,
          payout_method: data.payout_method,
          payout_phone: data.payout_phone,
          hasSettings,
        });
        if (hasSettings) {
          setHasPayoutSettings(true);
        } else {
          setHasPayoutSettings(false);
        }
      } else {
        console.warn(
          '[PROVIDER_DASHBOARD] No user doc while checking payout settings',
        );
        setHasPayoutSettings(false);
      }
    });
  }, [user]);

  // Helper to compute provider's take-home from a booking doc
  // ✅ Works with tiered markup & wallet:
  // 1) Prefer explicit providerAmount / base fields.
  // 2) If platformFee / markupAmount is present, use total - fee.
  // 3) If markupRate is present (fraction, e.g. 0.1), reverse that.
  // 4) Fallback: assume no markup and treat total as provider share (dashboard-only approximation).
  const providerShare = (b: any): number => {
    // 1) Explicit provider-side fields (what the provider should actually receive)
    const explicit = Number(
      b.providerAmount ??
        b.baseTotal ??
        b.subtotalBeforeMarkup ??
        b.subtotal ??
        b.basePrice,
    );
    if (!isNaN(explicit) && explicit > 0) return explicit;

    const total = Number(b.total) || 0;
    if (total <= 0) return 0;

    // 2) If we know the platform fee or markupAmount, compute provider via difference
    const feeLikeFields = ['platformFee', 'markupAmount'] as const;
    for (const key of feeLikeFields) {
      const fee = Number(b[key]);
      if (!isNaN(fee) && fee > 0 && fee < total) {
        const implied = total - fee;
        if (implied > 0) {
          return Math.round(implied * 100) / 100;
        }
      }
    }

    // 3) If we know the markupRate as a fraction (e.g. 0.1, 0.15), reverse it
    if (!isNaN(Number(b.markupRate))) {
      const rate = Number(b.markupRate);
      if (rate > 0 && rate < 1) {
        const implied = total / (1 + rate);
        if (implied > 0) {
          return Math.round(implied * 100) / 100;
        }
      }
    }

    // 4) Last resort: assume the provider gets the full total
    // (this only affects dashboard display, not real payouts)
    return Math.round(total * 100) / 100;
  };

  // ✅ Track earnings and withdrawals in real time
  // Available balance = verified earnings – (all initiated/pending/processing/success withdrawals)
  useEffect(() => {
    if (!user) return;
    setLoading(true);

    const bookingsRef = collection(db, 'bookings');
    const withdrawalsRef = collection(db, 'users', user.uid, 'withdrawals');

    // Only count bookings whose Service Release PIN has been verified
    const qBookings = query(
      bookingsRef,
      where('providerId', '==', user.uid),
      where('releaseVerified', '==', true),
    );

    const qWithdrawals = query(withdrawalsRef);

    let totalEarnings = 0;
    let totalWithdrawn = 0;

    const unsubBookings = onSnapshot(qBookings, (snap) => {
      totalEarnings = snap.docs.reduce((sum, d) => {
        const data = d.data();
        return sum + providerShare(data);
      }, 0);
      console.log('[PROVIDER_DASHBOARD] Bookings snapshot for earnings:', {
        count: snap.size,
        totalEarnings,
      });
      setBalance(totalEarnings - totalWithdrawn);
    });

    const unsubWithdrawals = onSnapshot(qWithdrawals, (snap) => {
      const raw = snap.docs.map((d) => ({
        id: d.id,
        ...d.data(),
      }));

      // ✅ Treat initiated/pending/processing as already deducted from available balance.
      totalWithdrawn = snap.docs.reduce((sum, d) => {
        const data = d.data() as any;
        const status = (data.status || '').toLowerCase();
        const amount = Number(data.amount) || 0;

        const countAsWithdrawn = [
          'completed',
          'success',
          'initiated',
          'pending',
          'processing',
        ].includes(status);

        return countAsWithdrawn ? sum + amount : sum;
      }, 0);

      console.log('[PROVIDER_DASHBOARD] Withdrawals snapshot:', {
        totalDocs: snap.size,
        docs: raw,
        totalWithdrawn,
        resultingBalance: totalEarnings - totalWithdrawn,
      });

      setBalance(totalEarnings - totalWithdrawn);
      setLoading(false);
    });

    return () => {
      unsubBookings();
      unsubWithdrawals();
    };
  }, [user]);

  // 💸 Load pending payouts (paid bookings where releaseVerified is NOT true)
  useEffect(() => {
    if (!user) return;

    (async () => {
      try {
        const bookingsRef = collection(db, 'bookings');
        const snap = await getDocs(
          query(
            bookingsRef,
            where('providerId', '==', user.uid),
            // statuses that represent paid / in-progress bookings
            where('status', 'in', ['confirmed', 'accepted', 'completed']),
          ),
        );

        let total = 0;
        const pending: { id: string; [key: string]: any }[] = [];

        snap.forEach((d) => {
          const data = d.data() as any;
          // Treat anything without releaseVerified === true as pending
          if (!data.releaseVerified) {
            total += providerShare(data);
            pending.push({ id: d.id, ...data });
          }
        });

        console.log('[PROVIDER_DASHBOARD] Loaded pending payouts:', {
          bookingsCount: snap.size,
          pendingCount: pending.length,
          pendingTotal: total,
        });

        setPendingEarnings(Math.round(total * 100) / 100);
        setPendingBookings(pending);
      } catch (err) {
        console.error('Pending funds load error:', err);
      }
    })();
  }, [user]);

  // 📊 Load statistics (bookings, followers, top videos/clients)
  useEffect(() => {
    if (!user) return;

    setStatsLoading(true);
    (async () => {
      try {
        // All bookings for this provider
        const bookingsSnap = await getDocs(
          query(collection(db, 'bookings'), where('providerId', '==', user.uid)),
        );
        console.log(
          '[PROVIDER_DASHBOARD] Stats bookings snapshot size:',
          bookingsSnap.size,
        );

        const summary: BookingSummary = {
          total: 0,
          pending: 0,
          accepted: 0,
          confirmed: 0,
          completed: 0,
          rejected: 0,
          cancelled: 0,
        };

        const byVideo = new Map<string, number>();
        const byClient = new Map<string, number>();
        let lost = 0; // provider-side value of refunded bookings

        bookingsSnap.forEach((d) => {
          const data = d.data() as any;
          summary.total += 1;
          const status = (data.status || '').toLowerCase();

          switch (status) {
            case 'pending':
              summary.pending += 1;
              break;
            case 'accepted':
              summary.accepted += 1;
              break;
            case 'confirmed':
              summary.confirmed += 1;
              break;
            case 'completed':
              summary.completed += 1;
              break;
            case 'rejected':
              summary.rejected += 1;
              break;
            case 'cancelled':
            case 'canceled':
              summary.cancelled += 1;
              break;
          }

          const vid = data.videoId as string | undefined;
          if (vid) {
            byVideo.set(vid, (byVideo.get(vid) || 0) + 1);
          }
          const cid = data.clientId as string | undefined;
          if (cid) {
            byClient.set(cid, (byClient.get(cid) || 0) + 1);
          }

          // Mark as "lost revenue" if refunded to client
          if (
            (status === 'rejected' ||
              status === 'cancelled' ||
              status === 'canceled') &&
            (data.refundWalletTxId || data.refundedAt)
          ) {
            lost += providerShare(data);
          }
        });

        console.log('[PROVIDER_DASHBOARD] Booking summary:', summary);

        setBookingSummary(summary);
        setLostRevenue(Math.round(lost * 100) / 100);

        // Followers
        const followersSnap = await getDocs(
          collection(db, 'users', user.uid, 'followers'),
        );
        console.log(
          '[PROVIDER_DASHBOARD] Followers count:',
          followersSnap.size,
        );
        setFollowersCount(followersSnap.size);

        // Video stats (bookings + likes)
        const videoStatList: VideoStat[] = [];
        for (const [videoId, bookingsCount] of byVideo.entries()) {
          try {
            const vSnap = await getDoc(doc(db, 'videos', videoId));
            let title = 'Untitled service';
            if (vSnap.exists()) {
              const vData = vSnap.data() as any;
              title = vData.title || vData.description || title;
            }
            let likes = 0;
            const likesSnap = await getDocs(
              collection(db, 'videos', videoId, 'likes'),
            );
            likes = likesSnap.size;
            videoStatList.push({
              videoId,
              title,
              bookings: bookingsCount,
              likes,
            });
          } catch (e) {
            console.error('Error loading video stats for', videoId, e);
          }
        }
        setVideoStats(videoStatList);

        // Loyal clients (most bookings)
        const clientStatList: ClientStat[] = [];
        for (const [clientId, bookingsCount] of byClient.entries()) {
          try {
            const cSnap = await getDoc(doc(db, 'users', clientId));
            let name = clientId;
            if (cSnap.exists()) {
              const cData = cSnap.data() as any;
              name =
                cData.fullName ||
                cData.username ||
                cData.businessName ||
                cData.phone ||
                clientId;
            }
            clientStatList.push({ clientId, name, bookings: bookingsCount });
          } catch (e) {
            console.error('Error loading client stats for', clientId, e);
          }
        }
        clientStatList.sort((a, b) => b.bookings - a.bookings);
        setLoyalClients(clientStatList.slice(0, 5));
      } catch (err) {
        console.error('Stats load error:', err);
      } finally {
        setStatsLoading(false);
      }
    })();
  }, [user]);

  // 🔁 Live subscription for provider "away days"
  useEffect(() => {
    if (!user) return;
    setAvailabilityLoading(true);
    const colRef = collection(db, 'users', user.uid, 'awayDays');

    const unsub = onSnapshot(
      colRef,
      (snap) => {
        const list: string[] = [];
        snap.forEach((d) => {
          const data = d.data() as AwayDay;
          const date = data.date || d.id;
          if (date) list.push(date);
        });
        setAwayDates(list);
        setAvailabilityLoading(false);
      },
      (err) => {
        console.error('[PROVIDER_DASHBOARD] awayDays snapshot error', err);
        setAvailabilityLoading(false);
      },
    );

    return () => unsub();
  }, [user]);

  // Early returns AFTER all hooks (no hooks below this point)
  if (!user) return <p className="p-6">Please sign in to view this page.</p>;
  if (loading && activeTab === 'wallet')
    return <p className="p-6">Loading balance…</p>;

  const handleWithdrawClick = () => {
    console.log('[PROVIDER_DASHBOARD] Withdraw button clicked', {
      hasPayoutSettings,
      balance,
    });
    if (hasPayoutSettings) {
      setShowWithdraw(true);
    } else {
      setShowPayoutSettings(true);
    }
  };

  // Toggle an away day on the availability calendar
  const handleToggleAwayDate = async (date: Date) => {
    if (!user) return;
    if (isPastDay(date)) {
      alert('You cannot block off past dates.');
      return;
    }

    const iso = dateToISO(date); // local-safe
    const currentlyAway = awayDates.includes(iso);
    const ref = doc(db, 'users', user.uid, 'awayDays', iso);
    const humanLabel = date.toDateString();

    // Removing away day (with confirmation)
    if (currentlyAway) {
      const ok = window.confirm(
        `Remove ${humanLabel} as a day off and allow bookings again on this date?`,
      );
      if (!ok) return;

      try {
        await deleteDoc(ref);
      } catch (err) {
        console.error('Failed to remove away day:', err);
        alert('Could not remove this away day. Please try again.');
      }
      return;
    }

    // Before adding, check for existing bookings on this date
    try {
      const bookingsSnap = await getDocs(
        query(
          collection(db, 'bookings'),
          where('providerId', '==', user.uid),
        ),
      );

      const activeStatuses = ['pending', 'accepted', 'confirmed'];

      let conflictCount = 0;
      bookingsSnap.forEach((d) => {
        const data = d.data() as any;
        const status = (data.status || '').toLowerCase();
        const dateStr = data.date;
        const isActive = activeStatuses.includes(status);
        if (isActive && dateStr === iso) {
          conflictCount += 1;
        }
      });

      if (conflictCount > 0) {
        const ok = window.confirm(
          `You already have ${conflictCount} active booking${
            conflictCount === 1 ? '' : 's'
          } on ${humanLabel}.\n\nTo block this day off completely, you need to cancel or reschedule those bookings from your bookings page.\n\nOpen your bookings page now?`,
        );
        if (ok) {
          router.push('/creator/bookings');
        }
        // Do NOT create away day if there are active bookings
        return;
      }

      // Confirm marking as unavailable
      const confirmAway = window.confirm(
        `Mark ${humanLabel} as unavailable for bookings? Clients will not be able to book you on this date.`,
      );
      if (!confirmAway) return;

      // No conflicting bookings — create the away day
      await setDoc(ref, {
        date: iso,
        fullDay: true,
        createdAt: Date.now(),
      } satisfies AwayDay);
    } catch (err) {
      console.error('Failed to set away day:', err);
      alert(
        'Could not update your away day for this date. Please try again in a moment.',
      );
    }
  };

  // Derived lists (no hooks, just plain computations)
  const mostBookedServices = [...videoStats]
    .sort((a, b) => b.bookings - a.bookings)
    .slice(0, 5);

  const mostLikedVideos = [...videoStats]
    .sort((a, b) => b.likes - a.likes)
    .slice(0, 5);

  const upcomingAwayDays = (() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return awayDates
      .map((d) => ({ date: d, asDate: parseISODate(d) }))
      .filter((x) => x.asDate.getTime() >= today.getTime())
      .sort((a, b) => a.asDate.getTime() - b.asDate.getTime());
  })();

  return (
    <div className="p-6 max-w-2xl mx-auto">
      <h1 className="text-2xl font-bold mb-4">Provider Dashboard</h1>

      {/* Tab toggles */}
      <div className="mb-6 flex justify-center">
        <div className="inline-flex rounded-full bg-gray-100 p-1">
          <button
            onClick={() => setActiveTab('wallet')}
            className={`px-4 py-1.5 text-sm rounded-full ${
              activeTab === 'wallet'
                ? 'bg-white shadow text-green-700 font-semibold'
                : 'text-gray-600 hover:text-gray-800'
            }`}
          >
            Wallet
          </button>
          <button
            onClick={() => setActiveTab('stats')}
            className={`px-4 py-1.5 text-sm rounded-full ${
              activeTab === 'stats'
                ? 'bg-white shadow text-green-700 font-semibold'
                : 'text-gray-600 hover:text-gray-800'
            }`}
          >
            Statistics
          </button>
          <button
            onClick={() => setActiveTab('availability')}
            className={`px-4 py-1.5 text-sm rounded-full ${
              activeTab === 'availability'
                ? 'bg-white shadow text-green-700 font-semibold'
                : 'text-gray-600 hover:text-gray-800'
            }`}
          >
            Availability
          </button>
        </div>
      </div>

      {/* WALLET TAB */}
      {activeTab === 'wallet' && (
        <>
          {/* Wallet balance */}
          <div className="p-6 bg-white shadow rounded mb-4">
            <h2 className="font-semibold text-gray-600">Available Balance</h2>
            <p className="text-3xl font-bold text-green-700 mt-2">
              KSH {balance.toFixed(2)}
            </p>
            <p className="mt-2 text-xs text-gray-500">
              This is your share from completed bookings whose Service Release
              PIN has been verified, minus all withdrawals you have already
              initiated (including those still waiting for M-Pesa confirmation).
            </p>
          </div>

          {/* Pending payouts */}
          <div className="p-4 bg-white shadow rounded mb-6">
            <h2 className="font-semibold text-gray-700">Pending Payouts</h2>
            <p className="text-xl font-bold text-amber-700 mt-1">
              KSH {pendingEarnings.toFixed(2)}
            </p>
            <p className="mt-1 text-xs text-gray-500">
              These are bookings that have been paid but whose Service Release
              PIN has not yet been verified. Once verified, they will move into
              your available balance.
            </p>

            {pendingBookings.length > 0 ? (
              <div className="mt-3 max-h-56 overflow-auto border-t pt-2 text-xs text-gray-700 space-y-1">
                {pendingBookings.map((b) => {
                  const dateStr = b.date
                    ? parseISODate(b.date).toLocaleDateString()
                    : '-';
                  const timeStr = b.time || '-';
                  const amount = providerShare(b);
                  return (
                    <div
                      key={b.id}
                      className="flex justify-between items-center gap-2"
                    >
                      <div className="truncate">
                        <span className="font-semibold">
                          {b.shortId || b.id}
                        </span>
                        <span className="ml-1 text-gray-500">
                          • {dateStr} {timeStr}
                        </span>
                      </div>
                      <span className="shrink-0 font-semibold">
                        KSH {amount.toFixed(2)}
                      </span>
                    </div>
                  );
                })}
              </div>
            ) : (
              <p className="mt-2 text-xs text-gray-500">
                You have no pending payouts. Completed bookings with verified
                PINs are already available in your balance.
              </p>
            )}
          </div>

          {/* Refunded / lost revenue card */}
          <div className="p-4 bg-white shadow rounded mb-6">
            <h2 className="font-semibold text-gray-700">
              Refunded / Cancelled Bookings
            </h2>
            <p className="text-xl font-bold text-red-700 mt-1">
              KSH {lostRevenue.toFixed(2)}
            </p>
            <p className="mt-1 text-xs text-gray-500">
              Total value of bookings that were confirmed, then later rejected
              or cancelled and refunded to clients. These amounts never entered
              your available balance.
            </p>
          </div>

          {/* Withdraw button */}
          <button
            onClick={handleWithdrawClick}
            className="w-full py-2 bg-green-600 text-white rounded hover:bg-green-700 transition mb-6"
          >
            Withdraw Funds
          </button>

          {/* Withdraw modal */}
          {showWithdraw && hasPayoutSettings && (
            <WithdrawModal
              available={balance}
              onClose={() => setShowWithdraw(false)}
            />
          )}

          {/* Payout settings modal */}
          {showPayoutSettings && (
            <PayoutSettingsModal
              onClose={() => setShowPayoutSettings(false)}
              onSetupSuccess={() => {
                setHasPayoutSettings(true);
                setShowPayoutSettings(false);
                setShowWithdraw(true);
              }}
            />
          )}

          {/* Withdrawal history */}
          <WithdrawalHistory />
        </>
      )}

      {/* STATS TAB */}
      {activeTab === 'stats' && (
        <div className="space-y-6">
          {statsLoading && (
            <p className="text-sm text-gray-600">Loading statistics…</p>
          )}

          {!statsLoading && (
            <>
              {/* Bookings summary */}
              <div className="bg-white shadow rounded p-4">
                <h2 className="font-semibold text-gray-700 mb-2">Bookings</h2>
                {bookingSummary ? (
                  <dl className="grid grid-cols-2 gap-3 text-sm">
                    <div>
                      <dt className="text-gray-500">Total</dt>
                      <dd className="font-semibold">
                        {bookingSummary.total}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-gray-500">Pending</dt>
                      <dd className="font-semibold">
                        {bookingSummary.pending}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-gray-500">Accepted</dt>
                      <dd className="font-semibold">
                        {bookingSummary.accepted}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-gray-500">Confirmed</dt>
                      <dd className="font-semibold">
                        {bookingSummary.confirmed}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-gray-500">Completed</dt>
                      <dd className="font-semibold">
                        {bookingSummary.completed}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-gray-500">Rejected / Cancelled</dt>
                      <dd className="font-semibold">
                        {bookingSummary.rejected + bookingSummary.cancelled}
                      </dd>
                    </div>
                  </dl>
                ) : (
                  <p className="text-sm text-gray-500">
                    No bookings recorded yet.
                  </p>
                )}
              </div>

              {/* Followers */}
              <div className="bg-white shadow rounded p-4">
                <h2 className="font-semibold text-gray-700 mb-2">Followers</h2>
                <p className="text-3xl font-bold text-gray-800">
                  {followersCount ?? 0}
                </p>
              </div>

              {/* Most booked services */}
              <div className="bg-white shadow rounded p-4">
                <h2 className="font-semibold text-gray-700 mb-2">
                  Most booked services
                </h2>
                {mostBookedServices.length ? (
                  <ul className="text-sm space-y-1">
                    {mostBookedServices.map((v) => (
                      <li
                        key={v.videoId}
                        className="flex justify-between items-center"
                      >
                        <span className="truncate mr-2">{v.title}</span>
                        <span className="text-gray-700 font-semibold">
                          {v.bookings} booking
                          {v.bookings === 1 ? '' : 's'}
                        </span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-sm text-gray-500">
                    No services have been booked yet.
                  </p>
                )}
              </div>

              {/* Most liked videos */}
              <div className="bg-white shadow rounded p-4">
                <h2 className="font-semibold text-gray-700 mb-2">
                  Most liked videos
                </h2>
                {mostLikedVideos.length ? (
                  <ul className="text-sm space-y-1">
                    {mostLikedVideos.map((v) => (
                      <li
                        key={v.videoId}
                        className="flex justify-between items-center"
                      >
                        <span className="truncate mr-2">{v.title}</span>
                        <span className="text-gray-700 font-semibold">
                          {v.likes} like{v.likes === 1 ? '' : 's'}
                        </span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-sm text-gray-500">
                    No likes recorded on your videos yet.
                  </p>
                )}
              </div>

              {/* Loyal clients */}
              <div className="bg-white shadow rounded p-4">
                <h2 className="font-semibold text-gray-700 mb-2">
                  Loyal clients
                </h2>
                {loyalClients.length ? (
                  <ul className="text-sm space-y-1">
                    {loyalClients.map((c) => (
                      <li
                        key={c.clientId}
                        className="flex justify-between items-center"
                      >
                        <span className="truncate mr-2">{c.name}</span>
                        <span className="text-gray-700 font-semibold">
                          {c.bookings} booking
                          {c.bookings === 1 ? '' : 's'}
                        </span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-sm text-gray-500">
                    Loyal clients will appear here as clients book you multiple
                    times.
                  </p>
                )}
              </div>
            </>
          )}
        </div>
      )}

      {/* AVAILABILITY TAB */}
      {activeTab === 'availability' && (
        <div className="bg-white shadow rounded p-4 space-y-4">
          <h2 className="font-semibold text-gray-800 mb-1">
            Calendar & Time Off
          </h2>
          <p className="text-xs text-gray-600 mb-2">
            Use this calendar to block off full days when you are away or not
            accepting bookings. Clients will not be able to book you on these
            days, in addition to days you have not selected in your profile
            operating hours.
          </p>

          {availabilityLoading && (
            <p className="text-xs text-gray-500 mb-2">
              Loading your away days…
            </p>
          )}

          <div className="flex flex-col items-center">
            <Calendar
              onChange={(d) => {
                setSelectedAvailabilityDate(d as Date);
              }}
              onClickDay={(d) => handleToggleAwayDate(d)}
              value={selectedAvailabilityDate}
              tileClassName={({ date }) => {
                const iso = dateToISO(date);
                if (awayDates.includes(iso)) {
                  return 'bg-red-50 text-red-700 react-calendar__tile--now';
                }
                return undefined;
              }}
              tileDisabled={({ date, view }) => {
                if (view !== 'month') return false;
                return isPastDay(date);
              }}
            />
          </div>

          <div className="text-xs text-gray-600">
            <p className="mb-1 font-semibold">How it works:</p>
            <ul className="list-disc list-inside space-y-1">
              <li>
                Click a future date to toggle it as <strong>away</strong> (red).
              </li>
              <li>
                Away days are treated as fully unavailable on the booking
                calendar.
              </li>
              <li>
                If you already have confirmed or pending bookings on a date, you
                will be asked to manage them from your bookings page instead of
                blocking the day.
              </li>
            </ul>
          </div>

          {upcomingAwayDays.length > 0 && (
            <div className="mt-3 border-t pt-3">
              <h3 className="text-sm font-semibold text-gray-800 mb-1">
                Upcoming away days
              </h3>
              <ul className="text-xs text-gray-700 space-y-1">
                {upcomingAwayDays.map((d) => (
                  <li key={d.date} className="flex justify-between">
                    <span>{d.asDate.toDateString()}</span>
                    <button
                      type="button"
                      onClick={() => handleToggleAwayDate(d.asDate)}
                      className="text-red-600 hover:text-red-800"
                    >
                      Remove
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}