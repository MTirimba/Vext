'use client';

import { useState, useEffect, useMemo } from 'react';
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
} from 'firebase/firestore';
import {
  motion,
  AnimatePresence,
  useMotionValue,
  useTransform,
} from 'framer-motion';
import WithdrawModal from '@/components/WithdrawModal';
import WithdrawalHistory from '@/components/WithdrawalHistory';
import PayoutSettingsModal from '@/components/PayoutSettingsModal';

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

export default function ProviderDashboard() {
  const [user] = useAuthState(auth);

  // ----- UI tabs -----
  const [activeTab, setActiveTab] = useState<'wallet' | 'stats'>('wallet');

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

  // Animated number state
  const motionBalance = useMotionValue(balance);
  const displayBalance = useTransform(motionBalance, (latest) =>
    latest.toFixed(2),
  );

  // ----- stats state -----
  const [statsLoading, setStatsLoading] = useState(false);
  const [bookingSummary, setBookingSummary] = useState<BookingSummary | null>(
    null,
  );
  const [followersCount, setFollowersCount] = useState<number | null>(null);
  const [videoStats, setVideoStats] = useState<VideoStat[]>([]);
  const [loyalClients, setLoyalClients] = useState<ClientStat[]>([]);
  const [lostRevenue, setLostRevenue] = useState(0); // NEW – refunded/lost value

  const mostBookedServices = useMemo(
    () =>
      [...videoStats]
        .sort((a, b) => b.bookings - a.bookings)
        .slice(0, 5),
    [videoStats],
  );

  const mostLikedVideos = useMemo(
    () =>
      [...videoStats]
        .sort((a, b) => b.likes - a.likes)
        .slice(0, 5),
    [videoStats],
  );

  useEffect(() => {
    motionBalance.set(balance);
  }, [balance, motionBalance]);

  // ✅ Check payout settings
  useEffect(() => {
    if (!user) return;
    const userRef = doc(db, 'users', user.uid);

    getDoc(userRef).then((snap) => {
      if (snap.exists()) {
        const data = snap.data() as any;
        if (data.payout_method === 'mpesa' && data.payout_phone) {
          setHasPayoutSettings(true);
        } else {
          setHasPayoutSettings(false);
        }
      } else {
        setHasPayoutSettings(false);
      }
    });
  }, [user]);

  // Helper to compute provider's take-home from a booking doc
  // We prefer explicit base fields if present; otherwise we reverse the 10% markup.
  const providerShare = (b: any): number => {
    const explicit = Number(
      b.providerAmount ??
        b.baseTotal ??
        b.subtotalBeforeMarkup ??
        b.subtotal ??
        b.basePrice,
    );
    if (!isNaN(explicit) && explicit > 0) return explicit;

    const total = Number(b.total) || 0; // assumed to be customer-charged (includes +10%)
    // Reverse the +10% markup; keep two decimals.
    return Math.round((total / 1.1) * 100) / 100;
  };

  // ✅ Track earnings and withdrawals in real time (available balance – releaseVerified = true)
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
      setBalance(totalEarnings - totalWithdrawn);
    });

    const unsubWithdrawals = onSnapshot(qWithdrawals, (snap) => {
      totalWithdrawn = snap.docs
        .filter((d) =>
          ['completed', 'success'].includes(
            (d.data().status || '').toLowerCase(),
          ),
        )
        .reduce((sum, d) => sum + (d.data().amount || 0), 0);

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
        let lost = 0; // NEW – provider-side value of refunded bookings

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

        setBookingSummary(summary);
        setLostRevenue(Math.round(lost * 100) / 100);

        // Followers
        const followersSnap = await getDocs(
          collection(db, 'users', user.uid, 'followers'),
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
            videoStatList.push({ videoId, title, bookings: bookingsCount, likes });
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

  if (!user) return <p className="p-6">Please sign in to view this page.</p>;
  if (loading && activeTab === 'wallet')
    return <p className="p-6">Loading balance…</p>;

  const handleWithdrawClick = () => {
    if (hasPayoutSettings) {
      setShowWithdraw(true);
    } else {
      setShowPayoutSettings(true);
    }
  };

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
        </div>
      </div>

      {activeTab === 'wallet' ? (
        <>
          {/* Wallet balance */}
          <div className="p-6 bg-white shadow rounded mb-4">
            <h2 className="font-semibold text-gray-600">Available Balance</h2>
            <AnimatePresence mode="wait">
              <motion.p
                key={balance}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                transition={{ duration: 0.6 }}
                className="text-3xl font-bold text-green-700 mt-2"
              >
                KSH{' '}
                <motion.span
                  animate={{
                    opacity: [0.6, 1],
                    transition: { duration: 0.6 },
                  }}
                >
                  {displayBalance.get()}
                </motion.span>
              </motion.p>
            </AnimatePresence>
            <p className="mt-2 text-xs text-gray-500">
              Only bookings whose Service Release PIN has been verified are
              included in this balance.
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
                    ? new Date(b.date).toLocaleDateString()
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

          {/* NEW: Refunded / lost revenue card */}
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
      ) : (
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
    </div>
  );
}