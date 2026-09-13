// /workspaces/Vext/app/admin/page.tsx
'use client';

import { useEffect, useMemo, useState, Fragment } from 'react';
import { useAdminGate } from '@/components/useAdminGate';
import { db } from '@/lib/firebase';
import {
  collection,
  collectionGroup,
  getCountFromServer,
  query,
  where,
  orderBy,
  limit,
  getDocs,
  doc,
  getDoc,
  setDoc,
  updateDoc,
  addDoc,
} from 'firebase/firestore';

import {
  DEFAULT_MARKUP_TIERS,
  MarkupTier,
  parseMarkupTiers,
} from '@/lib/pricing';
import {
  DEFAULT_LOGISTICS_CONFIG,
  LogisticsConfig,
  parseLogisticsConfig,
} from '@/lib/logistics';

import WithdrawModal from '@/components/WithdrawModal';

type TabKey =
  | 'overview'
  | 'users'
  | 'creators'
  | 'bookings'
  | 'content'
  | 'finance'
  | 'markup'
  | 'transactions';

export default function AdminPage() {
  const gate = useAdminGate();
  const [active, setActive] = useState<TabKey>('overview');

  const [loading, setLoading] = useState(true);
  const [kpi, setKpi] = useState({
    users: 0,
    creators: 0,
    bookings: 0,
    gmv: 0,
  });
  const [recentBookings, setRecentBookings] = useState<any[]>([]);

  // Per-tab data
  const [users, setUsers] = useState<any[]>([]);
  const [creators, setCreators] = useState<any[]>([]);
  const [bookings, setBookings] = useState<any[]>([]);
  const [videos, setVideos] = useState<any[]>([]);

  // ---------- Transactions tab: flagged bookings + per-user ledger ----------
  const [flaggedBookings, setFlaggedBookings] = useState<any[]>([]);
  const [flaggedLoading, setFlaggedLoading] = useState(false);
  const [txSearchInput, setTxSearchInput] = useState('');
  const [txSearchLoading, setTxSearchLoading] = useState(false);
  const [txSearchError, setTxSearchError] = useState('');
  const [txUser, setTxUser] = useState<{ id: string; data: any } | null>(null);
  const [txEvents, setTxEvents] = useState<any[]>([]);
  const [txExpandedId, setTxExpandedId] = useState<string | null>(null);

  // Markup config
  const [markupTiers, setMarkupTiers] =
    useState<MarkupTier[]>(DEFAULT_MARKUP_TIERS);
  const [markupLoading, setMarkupLoading] = useState(true);
  const [markupSaving, setMarkupSaving] = useState(false);

  // 🚗 Logistics (housecall travel fee) config
  const [logisticsCfg, setLogisticsCfg] = useState<LogisticsConfig>(
    DEFAULT_LOGISTICS_CONFIG,
  );
  const [logisticsSaving, setLogisticsSaving] = useState(false);

  // --------- Finance tab extra state ---------
  const [financeSubTab, setFinanceSubTab] = useState<
    'flows' | 'clients' | 'payouts'
  >('flows');
  const [financeLoading, setFinanceLoading] = useState(false);

  const [paidBookings, setPaidBookings] = useState<any[]>([]);
  const [clientPaymentSummary, setClientPaymentSummary] = useState<any[]>([]);
  const [payouts, setPayouts] = useState<any[]>([]);

  // Admin/platform withdrawal modal
  const [showPlatformWithdraw, setShowPlatformWithdraw] = useState(false);

  // ---------- Initial load: KPIs + recent bookings (with joined names)
  useEffect(() => {
    if (gate !== 'ok') return;
    (async () => {
      setLoading(true);

      const usersRef = collection(db, 'users');
      const creatorsQ = query(usersRef, where('isProvider', '==', true));
      const bookingsRef = collection(db, 'bookings');

      const [usersCountSnap, creatorsCountSnap, bookingsCountSnap] =
        await Promise.all([
          getCountFromServer(usersRef),
          getCountFromServer(creatorsQ),
          getCountFromServer(bookingsRef),
        ]);

      // GMV (no orderBy to avoid composite index requirement)
      // Sum totals for confirmed/completed (paid volume)
      const gmvQ = query(
        bookingsRef,
        where('status', 'in', ['confirmed', 'completed']),
      );
      const gmvSnap = await getDocs(gmvQ);
      let gmv = 0;
      gmvSnap.forEach((d) => {
        const t = Number((d.data() as any).total) || 0;
        gmv += t;
      });

      // Recent bookings (unfiltered → safe to order by createdAt)
      const recentQ = query(
        bookingsRef,
        orderBy('createdAt', 'desc'),
        limit(8),
      );
      const recentSnap = await getDocs(recentQ);
      const rawRecent = recentSnap.docs.map((d) => ({
        id: d.id,
        ...d.data(),
      }));

      // Join client/provider names
      const joinIds = new Set<string>();
      rawRecent.forEach((b: any) => {
        if (b.clientId) joinIds.add(b.clientId);
        if (b.providerId) joinIds.add(b.providerId);
      });

      const nameCache: Record<string, any> = {};
      await Promise.all(
        Array.from(joinIds).map(async (uid) => {
          const us = await getDoc(doc(db, 'users', uid));
          if (us.exists()) nameCache[uid] = us.data();
        }),
      );

      const enrichedRecent = rawRecent.map((b: any) => ({
        ...b,
        clientName:
          nameCache[b.clientId]?.fullName ||
          nameCache[b.clientId]?.name ||
          nameCache[b.clientId]?.username ||
          b.clientId,
        providerName:
          nameCache[b.providerId]?.businessName ||
          nameCache[b.providerId]?.fullName ||
          nameCache[b.providerId]?.name ||
          nameCache[b.providerId]?.username ||
          b.providerId,
      }));

      setKpi({
        users: usersCountSnap.data().count,
        creators: creatorsCountSnap.data().count,
        bookings: bookingsCountSnap.data().count,
        gmv,
      });
      setRecentBookings(enrichedRecent);
      setLoading(false);
    })();
  }, [gate]);

  // ---------- Load pricing / markup config ----------
  useEffect(() => {
    if (gate !== 'ok') return;

    (async () => {
      try {
        const snap = await getDoc(doc(db, 'config', 'pricing'));
        if (snap.exists()) {
          const data = snap.data() as any;
          setMarkupTiers(parseMarkupTiers(data.tiers));
          setLogisticsCfg(parseLogisticsConfig(data.logistics));
        } else {
          setMarkupTiers(DEFAULT_MARKUP_TIERS);
          setLogisticsCfg(DEFAULT_LOGISTICS_CONFIG);
        }
      } catch (err) {
        console.error('admin pricing config load error', err);
        setMarkupTiers(DEFAULT_MARKUP_TIERS);
      } finally {
        setMarkupLoading(false);
      }
    })();
  }, [gate]);

  // ---------- Lazy-load per tab ----------
  useEffect(() => {
    if (gate !== 'ok') return;
    (async () => {
      if (active === 'users') {
        const snap = await getDocs(
          query(
            collection(db, 'users'),
            orderBy('createdAt', 'desc'),
            limit(25),
          ),
        );
        setUsers(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
      }
      if (active === 'creators') {
        const snap = await getDocs(
          query(
            collection(db, 'users'),
            where('isProvider', '==', true),
            limit(25),
          ),
        );
        setCreators(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
      }
      if (active === 'bookings') {
        const snap = await getDocs(
          query(
            collection(db, 'bookings'),
            orderBy('createdAt', 'desc'),
            limit(25),
          ),
        );
        const raw = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
        const ids = new Set<string>();
        raw.forEach((b: any) => {
          if (b.clientId) ids.add(b.clientId);
          if (b.providerId) ids.add(b.providerId);
        });
        const cache: Record<string, any> = {};
        await Promise.all(
          Array.from(ids).map(async (uid) => {
            const us = await getDoc(doc(db, 'users', uid));
            if (us.exists()) cache[uid] = us.data();
          }),
        );
        const enriched = raw.map((b: any) => ({
          ...b,
          clientName:
            cache[b.clientId]?.fullName ||
            cache[b.clientId]?.name ||
            cache[b.clientId]?.username ||
            b.clientId,
          providerName:
            cache[b.providerId]?.businessName ||
            cache[b.providerId]?.fullName ||
            cache[b.providerId]?.name ||
            cache[b.providerId]?.username ||
            b.providerId,
        }));
        setBookings(enriched);
      }
      if (active === 'content') {
        const snap = await getDocs(
          query(
            collection(db, 'videos'),
            orderBy('createdAt', 'desc'),
            limit(25),
          ),
        );
        const vids = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
        const ids = new Set<string>();
        vids.forEach((v: any) => v.userId && ids.add(v.userId));
        const cache: Record<string, any> = {};
        await Promise.all(
          Array.from(ids).map(async (uid) => {
            const us = await getDoc(doc(db, 'users', uid));
            if (us.exists()) cache[uid] = us.data();
          }),
        );
        const enriched = vids.map((v: any) => ({
          ...v,
          ownerName:
            cache[v.userId]?.businessName ||
            cache[v.userId]?.fullName ||
            cache[v.userId]?.name ||
            cache[v.userId]?.username ||
            v.userId,
        }));
        setVideos(enriched);
      }
      if (active === 'transactions') {
        setFlaggedLoading(true);
        try {
          // Bookings the Paystack-verification webhook (or any future
          // integrity check) flagged for manual review — see
          // paymentIntegrityFlag in confirmBookingCore / the webhook.
          const snap = await getDocs(
            query(
              collection(db, 'bookings'),
              where('paymentIntegrityFlag', '!=', null),
              orderBy('paymentIntegrityFlag'),
              orderBy('createdAt', 'desc'),
              limit(50),
            ),
          );
          const raw = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
          const ids = new Set<string>();
          raw.forEach((b: any) => {
            if (b.clientId) ids.add(b.clientId);
            if (b.providerId) ids.add(b.providerId);
          });
          const cache: Record<string, any> = {};
          await Promise.all(
            Array.from(ids).map(async (uid) => {
              const us = await getDoc(doc(db, 'users', uid));
              if (us.exists()) cache[uid] = us.data();
            }),
          );
          setFlaggedBookings(
            raw.map((b: any) => ({
              ...b,
              clientName:
                cache[b.clientId]?.fullName ||
                cache[b.clientId]?.name ||
                cache[b.clientId]?.username ||
                b.clientId,
              providerName:
                cache[b.providerId]?.businessName ||
                cache[b.providerId]?.fullName ||
                cache[b.providerId]?.name ||
                cache[b.providerId]?.username ||
                b.providerId,
            })),
          );
        } catch (err) {
          console.error('load flagged bookings error', err);
          setFlaggedBookings([]);
        } finally {
          setFlaggedLoading(false);
        }
      }
    })();
  }, [active, gate]);

  // ---------- Finance: detailed cash-flow data ----------
  useEffect(() => {
    if (gate !== 'ok') return;
    if (active !== 'finance') return;

    (async () => {
      try {
        setFinanceLoading(true);

        // 1) Incoming payments – bookings with paymentStatus === 'paid'
        const paidQ = query(
          collection(db, 'bookings'),
          where('paymentStatus', '==', 'paid'),
          limit(100),
        );
        const paidSnap = await getDocs(paidQ);
        const rawPaid = paidSnap.docs.map((d) => ({
          id: d.id,
          ...d.data(),
        })) as any[];

        // Collect client IDs to join names
        const clientIds = new Set<string>();
        rawPaid.forEach((b) => {
          if (b.clientId) clientIds.add(b.clientId);
        });

        const clientCache: Record<string, any> = {};
        await Promise.all(
          Array.from(clientIds).map(async (uid) => {
            const us = await getDoc(doc(db, 'users', uid));
            if (us.exists()) clientCache[uid] = us.data();
          }),
        );

        const enrichedPaid = rawPaid
          .map((b) => {
            const clientInfo = clientCache[b.clientId] || {};
            const clientName =
              clientInfo.fullName ||
              clientInfo.name ||
              clientInfo.username ||
              b.clientId ||
              '—';

            return {
              id: b.id,
              shortId: b.shortId,
              clientId: b.clientId,
              clientName,
              total: Number(b.total) || 0,
              paymentMethod: b.paymentMethod || 'unknown',
              createdAt: b.createdAt,
            };
          })
          .sort((a, b) => {
            const aVal: any = a.createdAt;
            const bVal: any = b.createdAt;

            const aTime =
              aVal?.toDate?.() instanceof Date
                ? aVal.toDate().getTime()
                : typeof aVal === 'number'
                  ? aVal
                  : 0;
            const bTime =
              bVal?.toDate?.() instanceof Date
                ? bVal.toDate().getTime()
                : typeof bVal === 'number'
                  ? bVal
                  : 0;
            return bTime - aTime;
          });

        setPaidBookings(enrichedPaid);

        // 2) Client payment summary – aggregate by client
        const byClient = new Map<
          string,
          { clientId: string; clientName: string; total: number; count: number }
        >();

        for (const row of enrichedPaid) {
          const key = row.clientId || 'unknown';
          const existing =
            byClient.get(key) || {
              clientId: row.clientId || 'unknown',
              clientName: row.clientName || '—',
              total: 0,
              count: 0,
            };
          existing.total += row.total || 0;
          existing.count += 1;
          byClient.set(key, existing);
        }

        const clientSummaryArr = Array.from(byClient.values()).sort(
          (a, b) => b.total - a.total,
        );
        setClientPaymentSummary(clientSummaryArr);

        // 3) Payouts – collection group on users/{uid}/withdrawals
        const payoutsQ = query(
          collectionGroup(db, 'withdrawals'),
          limit(100),
        );
        const payoutsSnap = await getDocs(payoutsQ);
        const rawPayouts = payoutsSnap.docs.map((d) => {
          const data = d.data() as any;
          const path = d.ref.path; // "users/{userId}/withdrawals/{withdrawalId}"
          const segments = path.split('/');
          const userId = segments.length >= 2 ? segments[1] : null;
          return {
            id: d.id,
            userId,
            ...data,
          };
        }) as any[];

        // Collect provider IDs to join names
        const providerIds = new Set<string>();
        rawPayouts.forEach((p) => {
          if (p.userId) providerIds.add(p.userId);
        });

        const providerCache: Record<string, any> = {};
        await Promise.all(
          Array.from(providerIds).map(async (uid) => {
            const us = await getDoc(doc(db, 'users', uid));
            if (us.exists()) providerCache[uid] = us.data();
          }),
        );

        const enrichedPayouts = rawPayouts
          .map((p) => {
            const u = p.userId ? providerCache[p.userId] : null;
            const providerName =
              u?.businessName ||
              u?.fullName ||
              u?.name ||
              u?.username ||
              p.userId ||
              '—';
            const phone = p.phoneNumber || u?.businessPhone || u?.phone || '—';
            return {
              ...p,
              providerName,
              phone,
            };
          })
          .sort((a, b) => {
            const aVal: any = a.createdAt;
            const bVal: any = b.createdAt;
            const aTime =
              aVal?.toDate?.() instanceof Date
                ? aVal.toDate().getTime()
                : typeof aVal === 'number'
                  ? aVal
                  : 0;
            const bTime =
              bVal?.toDate?.() instanceof Date
                ? bVal.toDate().getTime()
                : typeof bVal === 'number'
                  ? bVal
                  : 0;
            return bTime - aTime;
          });

        setPayouts(enrichedPayouts);
      } catch (err) {
        console.error('[ADMIN FINANCE] load error:', err);
      } finally {
        setFinanceLoading(false);
      }
    })();
  }, [active, gate]);

  // ❗ Hooks must always be called – so derived hooks come before early returns

  // Finance derived numbers – approximate using blended markup from tiers
  const blendedMarkupPercent = useMemo(() => {
    const valid = markupTiers.filter((t) => Number.isFinite(t.percent));
    if (!valid.length) return 10;
    const sum = valid.reduce((acc, t) => acc + t.percent, 0);
    return sum / valid.length;
  }, [markupTiers]);

  const appRevenue = Math.round(
    kpi.gmv * (blendedMarkupPercent / (100 + blendedMarkupPercent)),
  );
  const providerEarnings = Math.max(0, kpi.gmv - appRevenue);

  // 🎭 Mark/unmark an account as a demo/sales-demo account. When true, this
  // account and anything it uploads is hidden from the real feed and search
  // (see components/VideoFeed.tsx and app/search/page.tsx). Relies on the
  // same admin-claim gate (useAdminGate) as the rest of this page.
  const [demoTogglingId, setDemoTogglingId] = useState<string | null>(null);
  const handleToggleDemo = async (userId: string, nextValue: boolean) => {
    setDemoTogglingId(userId);
    try {
      await updateDoc(doc(db, 'users', userId), { isDemo: nextValue });
      setUsers((prev) =>
        prev.map((u) => (u.id === userId ? { ...u, isDemo: nextValue } : u)),
      );
      setCreators((prev) =>
        prev.map((u) => (u.id === userId ? { ...u, isDemo: nextValue } : u)),
      );
    } catch (err) {
      console.error('Failed to toggle isDemo:', err);
      alert('Failed to update demo status. Please try again.');
    } finally {
      setDemoTogglingId(null);
    }
  };

  // 💰 Fund a demo account's wallet directly — for setting up the live
  // wallet-payment part of a sales demo without editing Firestore by hand.
  // Guarded twice: the button only renders for isDemo-flagged rows, and the
  // handler itself refuses to run against any account not flagged isDemo,
  // so this can never be used to credit a real user's wallet by mistake.
  const [demoFundAmounts, setDemoFundAmounts] = useState<Record<string, string>>({});
  const [demoFundingId, setDemoFundingId] = useState<string | null>(null);
  const handleFundDemoWallet = async (targetUser: any) => {
    if (!targetUser?.isDemo) {
      alert('This account is not flagged as a demo account.');
      return;
    }
    const raw = demoFundAmounts[targetUser.id];
    const amount = Number(raw);
    if (!amount || amount <= 0) {
      alert('Enter a valid amount to fund.');
      return;
    }
    setDemoFundingId(targetUser.id);
    try {
      await addDoc(collection(db, 'users', targetUser.id, 'walletTransactions'), {
        amount,
        type: 'credit',
        status: 'completed',
        reason: 'demo_topup',
        createdAt: Date.now(),
      });
      setDemoFundAmounts((prev) => ({ ...prev, [targetUser.id]: '' }));
      alert(`Funded KES ${amount} into ${targetUser.username || targetUser.id}'s demo wallet.`);
    } catch (err) {
      console.error('Failed to fund demo wallet:', err);
      alert('Failed to fund demo wallet. Please try again.');
    } finally {
      setDemoFundingId(null);
    }
  };

  const handleSaveMarkup = async () => {
    try {
      setMarkupSaving(true);
      await setDoc(
        doc(db, 'config', 'pricing'),
        { tiers: markupTiers },
        { merge: true },
      );
      alert('Markup settings saved.');
    } catch (err) {
      console.error('save markup error', err);
      alert('Could not save markup settings. Please try again.');
    } finally {
      setMarkupSaving(false);
    }
  };

  const handleSaveLogistics = async () => {
    try {
      setLogisticsSaving(true);
      await setDoc(
        doc(db, 'config', 'pricing'),
        { logistics: logisticsCfg },
        { merge: true },
      );
      alert('Logistics fee settings saved.');
    } catch (err) {
      console.error('save logistics config error', err);
      alert('Could not save logistics settings. Please try again.');
    } finally {
      setLogisticsSaving(false);
    }
  };

  // ---------- Transactions: resolve a user, build their unified ledger ----------
  const nameOf = (u: any) =>
    u?.businessName || u?.fullName || u?.name || u?.username || u?.id;

  const handleTxSearch = async () => {
    const raw = txSearchInput.trim();
    if (!raw) return;

    setTxSearchLoading(true);
    setTxSearchError('');
    setTxUser(null);
    setTxEvents([]);

    try {
      // 1) Resolve the input to a user doc — try it as a raw uid first,
      // then fall back to matching on email / phone / username /
      // businessUsername, whichever the admin happened to paste in.
      let resolvedId: string | null = null;
      let resolvedData: any = null;

      const directSnap = await getDoc(doc(db, 'users', raw));
      if (directSnap.exists()) {
        resolvedId = directSnap.id;
        resolvedData = directSnap.data();
      } else {
        const fields = ['email', 'phone', 'businessPhone', 'username', 'businessUsername'];
        for (const field of fields) {
          const snap = await getDocs(
            query(collection(db, 'users'), where(field, '==', raw), limit(1)),
          );
          if (!snap.empty) {
            resolvedId = snap.docs[0].id;
            resolvedData = snap.docs[0].data();
            break;
          }
        }
      }

      if (!resolvedId) {
        setTxSearchError('No user found matching that uid, email, phone, or username.');
        setTxSearchLoading(false);
        return;
      }

      setTxUser({ id: resolvedId, data: resolvedData });

      // 2) Pull every money-relevant record involving this user, from every
      // place money touches them — this is the whole point of the tool, so
      // completeness matters more than trimming it down.
      const [asClientSnap, asProviderSnap, walletSnap, withdrawalsSnap] =
        await Promise.all([
          getDocs(
            query(
              collection(db, 'bookings'),
              where('clientId', '==', resolvedId),
              orderBy('createdAt', 'desc'),
              limit(200),
            ),
          ),
          getDocs(
            query(
              collection(db, 'bookings'),
              where('providerId', '==', resolvedId),
              orderBy('createdAt', 'desc'),
              limit(200),
            ),
          ),
          getDocs(
            query(
              collection(db, 'users', resolvedId, 'walletTransactions'),
              orderBy('createdAt', 'desc'),
              limit(200),
            ),
          ),
          getDocs(
            query(
              collection(db, 'users', resolvedId, 'withdrawals'),
              orderBy('createdAt', 'desc'),
              limit(200),
            ),
          ),
        ]);

      const events: any[] = [];

      asClientSnap.docs.forEach((d) => {
        const b = d.data() as any;
        events.push({
          id: `booking-client-${d.id}`,
          kind: 'Booking (as client)',
          timestamp: b.createdAt || 0,
          amount: b.total,
          status: b.status,
          label: `#${b.shortId || d.id} — ${b.serviceName || 'service'}`,
          raw: { ...b, _docId: d.id, _path: `bookings/${d.id}` },
        });
      });

      asProviderSnap.docs.forEach((d) => {
        const b = d.data() as any;
        events.push({
          id: `booking-provider-${d.id}`,
          kind: 'Booking (as provider)',
          timestamp: b.createdAt || 0,
          amount: b.providerAmount ?? b.total,
          status: b.status,
          label: `#${b.shortId || d.id} — ${b.serviceName || 'service'}`,
          raw: { ...b, _docId: d.id, _path: `bookings/${d.id}` },
        });
      });

      walletSnap.docs.forEach((d) => {
        const w = d.data() as any;
        events.push({
          id: `wallet-${d.id}`,
          kind: `Wallet ${w.type === 'debit' ? 'debit' : 'credit'}`,
          timestamp: w.createdAt || 0,
          amount: w.amount,
          status: w.status || w.reason,
          label: w.reason || w.bookingId || d.id,
          raw: { ...w, _docId: d.id, _path: `users/${resolvedId}/walletTransactions/${d.id}` },
        });
      });

      withdrawalsSnap.docs.forEach((d) => {
        const w = d.data() as any;
        events.push({
          id: `withdrawal-${d.id}`,
          kind: 'Withdrawal',
          timestamp: w.createdAt || 0,
          amount: w.amount,
          status: w.status,
          label: w.phoneNumber || d.id,
          raw: { ...w, _docId: d.id, _path: `users/${resolvedId}/withdrawals/${d.id}` },
        });
      });

      events.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
      setTxEvents(events);
    } catch (err) {
      console.error('transaction search error', err);
      setTxSearchError('Something went wrong loading this user\'s transactions.');
    } finally {
      setTxSearchLoading(false);
    }
  };

  // ✅ gate-based early returns AFTER all hooks
  if (gate === 'loading') return <p>Checking admin access…</p>;
  if (gate === 'signedout') return <p>Please sign in to access admin.</p>;
  if (gate === 'forbidden') return <p>Forbidden: admin access required.</p>;

  return (
    <div>
      {/* Page-level tabs only (layout nav removed) */}
      <div className="mb-4 flex items-center gap-2">
        <TabButton
          active={active === 'overview'}
          onClick={() => setActive('overview')}
          label="Overview"
        />
        <TabButton
          active={active === 'users'}
          onClick={() => setActive('users')}
          label="Users"
        />
        <TabButton
          active={active === 'creators'}
          onClick={() => setActive('creators')}
          label="Creators"
        />
        <TabButton
          active={active === 'bookings'}
          onClick={() => setActive('bookings')}
          label="Bookings"
        />
        <TabButton
          active={active === 'content'}
          onClick={() => setActive('content')}
          label="Content"
        />
        <TabButton
          active={active === 'finance'}
          onClick={() => setActive('finance')}
          label="Finance"
        />
        <TabButton
          active={active === 'markup'}
          onClick={() => setActive('markup')}
          label="Markup"
        />
        <TabButton
          active={active === 'transactions'}
          onClick={() => setActive('transactions')}
          label="Transactions"
        />
      </div>

      {/* Dynamic content area */}
      {active === 'overview' && (
        <div>
          <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-4">
            <KpiCard label="Users" value={kpi.users} />
            <KpiCard label="Creators" value={kpi.creators} />
            <KpiCard label="Bookings" value={kpi.bookings} />
            <KpiCard label="GMV (KSHS)" value={kpi.gmv.toLocaleString()} />
          </div>

          {loading ? (
            <p>Loading…</p>
          ) : (
            <>
              <h2 className="mb-3 text-xl font-semibold">Recent bookings</h2>
              <div className="space-y-2">
                {recentBookings.map((b) => (
                  <div
                    key={b.id}
                    className="flex items-center justify-between rounded border p-3"
                  >
                    <div className="text-sm">
                      <div className="font-semibold">
                        #{b.shortId || b.id}
                      </div>
                      <div className="text-gray-800">
                        <span className="font-medium">
                          {b.clientName}
                        </span>{' '}
                        →{' '}
                        <span className="font-medium">
                          {b.providerName}
                        </span>
                      </div>
                      <div className="text-gray-600">
                        {b.date
                          ? new Date(b.date).toLocaleString()
                          : '-'}{' '}
                        • {b.status || 'pending'}
                      </div>
                    </div>
                    <div className="text-right text-sm">
                      <div>
                        KSHS {Number(b.total || 0).toLocaleString()}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      )}

      {active === 'users' && (
        <div>
          <h2 className="mb-3 text-xl font-semibold">Users (latest)</h2>
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="border-b text-left">
                  <th className="py-2 pr-4">Full Name</th>
                  <th className="py-2 pr-4">Username</th>
                  <th className="py-2 pr-4">Email</th>
                  <th className="py-2 pr-4">Phone</th>
                  <th className="py-2 pr-4">Role</th>
                  <th className="py-2 pr-4">Provider?</th>
                  <th className="py-2 pr-4">Joined</th>
                  <th className="py-2 pr-4">Sign up via</th>
                  <th className="py-2 pr-4">Demo?</th>
                </tr>
              </thead>
              <tbody>
                {users.map((u) => (
                  <tr key={u.id} className="border-b last:border-0">
                    <td className="py-2 pr-4">
                      {u.fullName || u.name || '-'}
                    </td>
                    <td className="py-2 pr-4">
                      {u.username || '-'}
                    </td>
                    <td className="py-2 pr-4">
                      {u.email || '-'}
                    </td>
                    <td className="py-2 pr-4">
                      {u.businessPhone || u.phone || '-'}
                    </td>
                    <td className="py-2 pr-4">
                      {u.role || '-'}
                    </td>
                    <td className="py-2 pr-4">
                      {u.isProvider ? 'Yes' : 'No'}
                    </td>
                    <td className="py-2 pr-4 whitespace-nowrap">
                      {formatDateTime(u.createdAt)}
                    </td>
                    <td className="py-2 pr-4">
                      {inferSignupMethod(u)}
                    </td>
                    <td className="py-2 pr-4">
                      <button
                        type="button"
                        disabled={demoTogglingId === u.id}
                        onClick={() => handleToggleDemo(u.id, !u.isDemo)}
                        className={`text-xs px-2 py-1 rounded ${
                          u.isDemo
                            ? 'bg-amber-100 text-amber-800 border border-amber-300'
                            : 'bg-gray-100 text-gray-600 border border-gray-300'
                        }`}
                      >
                        {demoTogglingId === u.id
                          ? '...'
                          : u.isDemo
                          ? '🎭 Demo — unmark'
                          : 'Mark as demo'}
                      </button>

                      {u.isDemo && (
                        <div className="flex items-center gap-1 mt-1">
                          <input
                            type="number"
                            placeholder="KES"
                            className="w-16 text-xs border rounded px-1 py-0.5"
                            value={demoFundAmounts[u.id] || ''}
                            onChange={(e) =>
                              setDemoFundAmounts((prev) => ({
                                ...prev,
                                [u.id]: e.target.value,
                              }))
                            }
                          />
                          <button
                            type="button"
                            disabled={demoFundingId === u.id}
                            onClick={() => handleFundDemoWallet(u)}
                            className="text-xs px-2 py-0.5 rounded bg-green-100 text-green-800 border border-green-300"
                          >
                            {demoFundingId === u.id ? '...' : 'Fund wallet'}
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {active === 'creators' && (
        <div>
          <h2 className="mb-3 text-xl font-semibold">Creators</h2>
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="border-b text-left">
                  <th className="py-2 pr-4">Business / Name</th>
                  <th className="py-2 pr-4">Username</th>
                  <th className="py-2 pr-4">Phone</th>
                  <th className="py-2 pr-4">Town/County</th>
                  <th className="py-2 pr-4">Joined</th>
                  <th className="py-2 pr-4">Sign up via</th>
                  <th className="py-2 pr-4">Demo?</th>
                </tr>
              </thead>
              <tbody>
                {creators.map((u) => (
                  <tr key={u.id} className="border-b last:border-0">
                    <td className="py-2 pr-4">
                      {u.businessName || u.fullName || u.name || '-'}
                    </td>
                    <td className="py-2 pr-4">
                      {u.username || '-'}
                    </td>
                    <td className="py-2 pr-4">
                      {u.businessPhone || u.phone || '-'}
                    </td>
                    <td className="py-2 pr-4">
                      {[u.town, u.county].filter(Boolean).join(', ') ||
                        '-'}
                    </td>
                    <td className="py-2 pr-4 whitespace-nowrap">
                      {formatDateTime(u.createdAt)}
                    </td>
                    <td className="py-2 pr-4">
                      {inferSignupMethod(u)}
                    </td>
                    <td className="py-2 pr-4">
                      <button
                        type="button"
                        disabled={demoTogglingId === u.id}
                        onClick={() => handleToggleDemo(u.id, !u.isDemo)}
                        className={`text-xs px-2 py-1 rounded ${
                          u.isDemo
                            ? 'bg-amber-100 text-amber-800 border border-amber-300'
                            : 'bg-gray-100 text-gray-600 border border-gray-300'
                        }`}
                      >
                        {demoTogglingId === u.id
                          ? '...'
                          : u.isDemo
                          ? '🎭 Demo — unmark'
                          : 'Mark as demo'}
                      </button>

                      {u.isDemo && (
                        <div className="flex items-center gap-1 mt-1">
                          <input
                            type="number"
                            placeholder="KES"
                            className="w-16 text-xs border rounded px-1 py-0.5"
                            value={demoFundAmounts[u.id] || ''}
                            onChange={(e) =>
                              setDemoFundAmounts((prev) => ({
                                ...prev,
                                [u.id]: e.target.value,
                              }))
                            }
                          />
                          <button
                            type="button"
                            disabled={demoFundingId === u.id}
                            onClick={() => handleFundDemoWallet(u)}
                            className="text-xs px-2 py-0.5 rounded bg-green-100 text-green-800 border border-green-300"
                          >
                            {demoFundingId === u.id ? '...' : 'Fund wallet'}
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {active === 'bookings' && (
        <div>
          <h2 className="mb-3 text-xl font-semibold">
            Bookings (latest)
          </h2>
          <div className="space-y-2">
            {bookings.map((b) => (
              <div
                key={b.id}
                className="flex items-center justify-between rounded border p-3"
              >
                <div className="text-sm">
                  <div className="font-semibold">
                    #{b.shortId || b.id}
                  </div>
                  <div className="text-gray-800">
                    <span className="font-medium">
                      {b.clientName}
                    </span>{' '}
                    →{' '}
                    <span className="font-medium">
                      {b.providerName}
                    </span>
                  </div>
                  <div className="text-gray-600">
                    {b.date
                      ? new Date(b.date).toLocaleString()
                      : '-'}{' '}
                    • {b.status || 'pending'}
                  </div>
                </div>
                <div className="text-right text-sm">
                  <div>
                    KSHS {Number(b.total || 0).toLocaleString()}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {active === 'content' && (
        <div>
          <h2 className="mb-3 text-xl font-semibold">
            Content (latest)
          </h2>
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="border-b text-left">
                  <th className="py-2 pr-4">Title</th>
                  <th className="py-2 pr-4">Owner</th>
                  <th className="py-2 pr-4">Created</th>
                </tr>
              </thead>
              <tbody>
                {videos.map((v) => (
                  <tr key={v.id} className="border-b last:border-0">
                    <td className="py-2 pr-4">
                      {v.title || '-'}
                    </td>
                    <td className="py-2 pr-4">
                      {v.ownerName || v.userId}
                    </td>
                    <td className="py-2 pr-4">
                      {v.createdAt
                        ? new Date(v.createdAt).toLocaleString()
                        : '-'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {active === 'finance' && (
        <div>
          <h2 className="mb-3 text-xl font-semibold">Finance</h2>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <KpiCard
              label="GMV (KSHS)"
              value={kpi.gmv.toLocaleString()}
            />
            <KpiCard
              label="App revenue (KSHS)"
              value={appRevenue.toLocaleString()}
            />
            <KpiCard
              label="Provider earnings (KSHS)"
              value={providerEarnings.toLocaleString()}
            />
          </div>
          <p className="mt-4 text-sm text-gray-600">
            App revenue is currently estimated using the active markup
            tiers (blended rate ≈{' '}
            {blendedMarkupPercent.toFixed(1)}
            %). It assumes client prices already include markup and
            providers keep the full base price. If you later store a{' '}
            <code>platformFee</code> per booking, we’ll sum that
            directly instead of estimating.
          </p>

          {/* Platform withdrawal */}
          <div className="mt-4">
            <button
              type="button"
              onClick={() => setShowPlatformWithdraw(true)}
              disabled={appRevenue <= 0}
              className="rounded bg-gray-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Withdraw App Revenue
            </button>
            <p className="mt-1 text-xs text-gray-500 max-w-xl">
              This uses the same M-Pesa withdrawal flow as the wallet,
              with your estimated app revenue as the available balance.
            </p>
          </div>

          {/* Finance sub-tabs */}
          <div className="mt-8">
            <div className="mb-3 flex gap-2 border-b text-sm">
              <button
                type="button"
                onClick={() => setFinanceSubTab('flows')}
                className={`px-3 py-2 -mb-px border-b-2 ${
                  financeSubTab === 'flows'
                    ? 'border-black font-semibold'
                    : 'border-transparent text-gray-500 hover:text-gray-800'
                }`}
              >
                Incoming payments
              </button>
              <button
                type="button"
                onClick={() => setFinanceSubTab('clients')}
                className={`px-3 py-2 -mb-px border-b-2 ${
                  financeSubTab === 'clients'
                    ? 'border-black font-semibold'
                    : 'border-transparent text-gray-500 hover:text-gray-800'
                }`}
              >
                Client summary
              </button>
              <button
                type="button"
                onClick={() => setFinanceSubTab('payouts')}
                className={`px-3 py-2 -mb-px border-b-2 ${
                  financeSubTab === 'payouts'
                    ? 'border-black font-semibold'
                    : 'border-transparent text-gray-500 hover:text-gray-800'
                }`}
              >
                Provider payouts
              </button>
            </div>

            {financeLoading && (
              <p className="text-sm text-gray-600">
                Loading finance details…
              </p>
            )}

            {!financeLoading && financeSubTab === 'flows' && (
              <div className="overflow-x-auto text-sm">
                {paidBookings.length === 0 ? (
                  <p className="text-gray-500">
                    No paid bookings found yet.
                  </p>
                ) : (
                  <table className="min-w-full border">
                    <thead className="bg-gray-50">
                      <tr className="text-left">
                        <th className="px-3 py-2 border-r">Booking</th>
                        <th className="px-3 py-2 border-r">Client</th>
                        <th className="px-3 py-2 border-r">
                          Paid at (createdAt)
                        </th>
                        <th className="px-3 py-2 border-r">Method</th>
                        <th className="px-3 py-2">Amount (KSHS)</th>
                      </tr>
                    </thead>
                    <tbody>
                      {paidBookings.map((b) => {
                        const created: any = b.createdAt;
                        const dt =
                          created?.toDate?.() instanceof Date
                            ? created.toDate()
                            : typeof created === 'number'
                              ? new Date(created)
                              : null;
                        return (
                          <tr key={b.id} className="border-t">
                            <td className="px-3 py-2 border-r whitespace-nowrap">
                              #{b.shortId || b.id}
                            </td>
                            <td className="px-3 py-2 border-r">
                              {b.clientName}
                            </td>
                            <td className="px-3 py-2 border-r whitespace-nowrap">
                              {dt ? dt.toLocaleString() : '—'}
                            </td>
                            <td className="px-3 py-2 border-r capitalize">
                              {b.paymentMethod || '—'}
                            </td>
                            <td className="px-3 py-2 text-right">
                              {b.total.toLocaleString()}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                )}
              </div>
            )}

            {!financeLoading && financeSubTab === 'clients' && (
              <div className="overflow-x-auto text-sm">
                {clientPaymentSummary.length === 0 ? (
                  <p className="text-gray-500">
                    No client payments found yet.
                  </p>
                ) : (
                  <table className="min-w-full border">
                    <thead className="bg-gray-50">
                      <tr className="text-left">
                        <th className="px-3 py-2 border-r">Client</th>
                        <th className="px-3 py-2 border-r">
                          Total paid (KSHS)
                        </th>
                        <th className="px-3 py-2">Bookings</th>
                      </tr>
                    </thead>
                    <tbody>
                      {clientPaymentSummary.map((c) => (
                        <tr key={c.clientId} className="border-t">
                          <td className="px-3 py-2 border-r">
                            {c.clientName}
                          </td>
                          <td className="px-3 py-2 border-r text-right">
                            {c.total.toLocaleString()}
                          </td>
                          <td className="px-3 py-2">
                            {c.count}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            )}

            {!financeLoading && financeSubTab === 'payouts' && (
              <div className="overflow-x-auto text-sm">
                {payouts.length === 0 ? (
                  <p className="text-gray-500">
                    No provider payouts recorded yet.
                  </p>
                ) : (
                  <table className="min-w-full border">
                    <thead className="bg-gray-50">
                      <tr className="text-left">
                        <th className="px-3 py-2 border-r">
                          Provider
                        </th>
                        <th className="px-3 py-2 border-r">
                          User ID
                        </th>
                        <th className="px-3 py-2 border-r">
                          Phone
                        </th>
                        <th className="px-3 py-2 border-r">
                          Amount (KSHS)
                        </th>
                        <th className="px-3 py-2 border-r">
                          Status
                        </th>
                        <th className="px-3 py-2">
                          Created
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {payouts.map((p) => {
                        const created: any = p.createdAt;
                        const dt =
                          created?.toDate?.() instanceof Date
                            ? created.toDate()
                            : typeof created === 'number'
                              ? new Date(created)
                              : null;
                        return (
                          <tr key={p.id} className="border-t">
                            <td className="px-3 py-2 border-r">
                              {p.providerName}
                            </td>
                            <td className="px-3 py-2 border-r whitespace-nowrap">
                              {p.userId}
                            </td>
                            <td className="px-3 py-2 border-r">
                              {p.phone}
                            </td>
                            <td className="px-3 py-2 border-r text-right">
                              {(p.amount || 0).toLocaleString()}
                            </td>
                            <td className="px-3 py-2 border-r capitalize">
                              {p.status || '—'}
                            </td>
                            <td className="px-3 py-2 whitespace-nowrap">
                              {dt ? dt.toLocaleString() : '—'}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {active === 'markup' && (
        <div>
          <h2 className="mb-3 text-xl font-semibold">
            Markup settings
          </h2>
          <p className="mb-4 text-sm text-gray-600">
            These tiers control how much the app adds on top of
            providers&apos; base prices. Clients see the marked-up
            price; providers receive the base amount they set.
          </p>

          {markupLoading ? (
            <p>Loading markup settings…</p>
          ) : (
            <div className="mb-4 overflow-x-auto">
              <table className="min-w-full border text-sm">
                <thead>
                  <tr className="bg-gray-50 text-left">
                    <th className="border-r px-3 py-2">Tier</th>
                    <th className="border-r px-3 py-2">
                      Min base (KSHS)
                    </th>
                    <th className="border-r px-3 py-2">
                      Max base (KSHS)
                    </th>
                    <th className="px-3 py-2">Markup %</th>
                  </tr>
                </thead>
                <tbody>
                  {markupTiers.map((tier, idx) => (
                    <tr key={idx} className="border-t">
                      <td className="border-r px-3 py-2">
                        #{idx + 1}
                      </td>
                      <td className="border-r px-3 py-2">
                        <input
                          type="number"
                          className="w-full rounded border px-2 py-1 text-sm"
                          value={tier.min}
                          min={0}
                          onChange={(e) => {
                            const val = Number(e.target.value) || 0;
                            setMarkupTiers((prev) =>
                              prev.map((t, i) =>
                                i === idx ? { ...t, min: val } : t,
                              ),
                            );
                          }}
                        />
                      </td>
                      <td className="border-r px-3 py-2">
                        <input
                          type="number"
                          className="w-full rounded border px-2 py-1 text-sm"
                          value={tier.max ?? ''}
                          min={0}
                          onChange={(e) => {
                            const val =
                              e.target.value === ''
                                ? null
                                : Number(e.target.value) || 0;
                            setMarkupTiers((prev) =>
                              prev.map((t, i) =>
                                i === idx ? { ...t, max: val } : t,
                              ),
                            );
                          }}
                          placeholder="No max"
                        />
                      </td>
                      <td className="px-3 py-2">
                        <input
                          type="number"
                          className="w-full rounded border px-2 py-1 text-sm"
                          value={tier.percent}
                          min={0}
                          step={0.1}
                          onChange={(e) => {
                            const val = Number(e.target.value) || 0;
                            setMarkupTiers((prev) =>
                              prev.map((t, i) =>
                                i === idx
                                  ? { ...t, percent: val }
                                  : t,
                              ),
                            );
                          }}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <button
            type="button"
            onClick={handleSaveMarkup}
            disabled={markupSaving || markupLoading}
            className="rounded bg-black px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
          >
            {markupSaving ? 'Saving…' : 'Save markup settings'}
          </button>

          <p className="mt-4 text-xs text-gray-500">
            Ranges are interpreted as{' '}
            <code>min ≤ base price &lt; max</code>. Leave{' '}
            <strong>max</strong> blank on the last tier to apply it to
            all higher prices.
          </p>

          <hr className="my-8" />

          <h2 className="mb-3 text-xl font-semibold">
            Housecall logistics fee
          </h2>
          <p className="mb-4 text-sm text-gray-600">
            One platform-wide rate for housecall/outcall bookings — charged
            to the client on top of the service price and paid to the
            provider in full, so there&apos;s nothing for the two of them to
            negotiate before booking.
          </p>

          <div className="mb-4 grid max-w-md grid-cols-2 gap-4 text-sm">
            <label className="block">
              <span className="block text-gray-600 mb-1">
                Base fee (KSHS)
              </span>
              <input
                type="number"
                className="w-full rounded border px-2 py-1"
                min={0}
                value={logisticsCfg.baseFee}
                onChange={(e) =>
                  setLogisticsCfg((prev) => ({
                    ...prev,
                    baseFee: Number(e.target.value) || 0,
                  }))
                }
              />
            </label>
            <label className="block">
              <span className="block text-gray-600 mb-1">
                Per-km rate (KSHS)
              </span>
              <input
                type="number"
                className="w-full rounded border px-2 py-1"
                min={0}
                value={logisticsCfg.perKmRate}
                onChange={(e) =>
                  setLogisticsCfg((prev) => ({
                    ...prev,
                    perKmRate: Number(e.target.value) || 0,
                  }))
                }
              />
            </label>
            <label className="block">
              <span className="block text-gray-600 mb-1">
                Minimum fee (KSHS)
              </span>
              <input
                type="number"
                className="w-full rounded border px-2 py-1"
                min={0}
                value={logisticsCfg.minFee}
                onChange={(e) =>
                  setLogisticsCfg((prev) => ({
                    ...prev,
                    minFee: Number(e.target.value) || 0,
                  }))
                }
              />
            </label>
            <label className="block">
              <span className="block text-gray-600 mb-1">
                Maximum fee (KSHS, blank = no cap)
              </span>
              <input
                type="number"
                className="w-full rounded border px-2 py-1"
                min={0}
                value={logisticsCfg.maxFee ?? ''}
                placeholder="No max"
                onChange={(e) =>
                  setLogisticsCfg((prev) => ({
                    ...prev,
                    maxFee:
                      e.target.value === '' ? null : Number(e.target.value) || 0,
                  }))
                }
              />
            </label>
            <label className="block col-span-2">
              <span className="block text-gray-600 mb-1">
                Fallback flat fee when the provider has no pinned location
                (KSHS)
              </span>
              <input
                type="number"
                className="w-full rounded border px-2 py-1"
                min={0}
                value={logisticsCfg.noProviderLocationFallbackFee}
                onChange={(e) =>
                  setLogisticsCfg((prev) => ({
                    ...prev,
                    noProviderLocationFallbackFee:
                      Number(e.target.value) || 0,
                  }))
                }
              />
            </label>
          </div>

          <button
            type="button"
            onClick={handleSaveLogistics}
            disabled={logisticsSaving}
            className="rounded bg-black px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
          >
            {logisticsSaving ? 'Saving…' : 'Save logistics settings'}
          </button>

          <p className="mt-4 text-xs text-gray-500">
            Fee = base fee + (per-km rate × straight-line distance between
            provider and client pins), clamped to the min/max above. This
            fee is never marked up — it's added on top of the client's total
            and paid to the provider in full.
          </p>
        </div>
      )}

      {active === 'transactions' && (
        <div>
          <h2 className="mb-1 text-xl font-semibold">Money flows</h2>
          <p className="mb-6 text-sm text-gray-600">
            A backup you can come back to when something looks off — pull up
            everywhere money touched a specific person (bookings on either
            side, wallet credits/debits, withdrawals), or jump straight to
            anything already flagged for review.
          </p>

          {/* Flagged bookings — surfaces itself, no search needed */}
          <div className="mb-8">
            <h3 className="mb-2 text-sm font-semibold text-gray-900">
              Flagged for review ({flaggedBookings.length})
            </h3>
            <p className="mb-3 text-xs text-gray-500">
              Bookings the Paystack payment-verification check couldn't
              confidently confirm — see <code>paymentIntegrityFlag</code> on
              each booking doc for why.
            </p>
            {flaggedLoading ? (
              <p className="text-sm text-gray-500">Loading…</p>
            ) : flaggedBookings.length === 0 ? (
              <p className="text-sm text-gray-500">
                Nothing flagged right now.
              </p>
            ) : (
              <div className="space-y-2">
                {flaggedBookings.map((b) => (
                  <div
                    key={b.id}
                    className="rounded border border-amber-300 bg-amber-50 p-3 text-sm"
                  >
                    <div className="flex items-center justify-between">
                      <div>
                        <span className="font-semibold">
                          #{b.shortId || b.id}
                        </span>{' '}
                        <span className="text-gray-700">
                          {b.clientName} → {b.providerName}
                        </span>
                      </div>
                      <div className="font-medium">
                        KSHS {Number(b.total || 0).toLocaleString()}
                      </div>
                    </div>
                    <div className="mt-1 text-xs text-amber-800">
                      {b.paymentIntegrityFlag}
                    </div>
                    <button
                      type="button"
                      onClick={() =>
                        setTxExpandedId(
                          txExpandedId === `flag-${b.id}` ? null : `flag-${b.id}`,
                        )
                      }
                      className="mt-1 text-xs text-blue-600 hover:underline"
                    >
                      {txExpandedId === `flag-${b.id}` ? 'Hide' : 'View'} raw
                      record
                    </button>
                    {txExpandedId === `flag-${b.id}` && (
                      <pre className="mt-2 max-h-64 overflow-auto rounded bg-white p-2 text-xs">
                        {JSON.stringify(b, null, 2)}
                      </pre>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          <hr className="my-6" />

          {/* Per-user search */}
          <h3 className="mb-2 text-sm font-semibold text-gray-900">
            Look up a specific person's transaction history
          </h3>
          <div className="mb-4 flex gap-2">
            <input
              type="text"
              value={txSearchInput}
              onChange={(e) => setTxSearchInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleTxSearch()}
              placeholder="uid, email, phone, or username"
              className="w-full max-w-md rounded border px-3 py-2 text-sm"
            />
            <button
              type="button"
              onClick={handleTxSearch}
              disabled={txSearchLoading}
              className="rounded bg-black px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
            >
              {txSearchLoading ? 'Searching…' : 'Search'}
            </button>
          </div>

          {txSearchError && (
            <p className="mb-4 text-sm text-red-600">{txSearchError}</p>
          )}

          {txUser && (
            <div className="mb-4 rounded border bg-gray-50 p-3 text-sm">
              <div className="font-semibold">{nameOf(txUser.data)}</div>
              <div className="text-gray-600">
                uid: {txUser.id}
                {txUser.data?.email && <> • {txUser.data.email}</>}
                {(txUser.data?.businessPhone || txUser.data?.phone) && (
                  <> • {txUser.data.businessPhone || txUser.data.phone}</>
                )}
                {txUser.data?.isProvider && <> • Provider</>}
              </div>
            </div>
          )}

          {txEvents.length > 0 && (
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="border-b text-left">
                    <th className="py-2 pr-4">When</th>
                    <th className="py-2 pr-4">Type</th>
                    <th className="py-2 pr-4">Reference</th>
                    <th className="py-2 pr-4">Status</th>
                    <th className="py-2 pr-4 text-right">Amount</th>
                    <th className="py-2 pr-4"></th>
                  </tr>
                </thead>
                <tbody>
                  {txEvents.map((ev) => (
                    <Fragment key={ev.id}>
                      <tr className="border-b last:border-0 align-top">
                        <td className="py-2 pr-4 whitespace-nowrap">
                          {ev.timestamp
                            ? new Date(ev.timestamp).toLocaleString()
                            : '-'}
                        </td>
                        <td className="py-2 pr-4">{ev.kind}</td>
                        <td className="py-2 pr-4">{ev.label}</td>
                        <td className="py-2 pr-4">{ev.status || '-'}</td>
                        <td className="py-2 pr-4 text-right">
                          {typeof ev.amount === 'number'
                            ? `KSHS ${ev.amount.toLocaleString()}`
                            : '-'}
                        </td>
                        <td className="py-2 pr-4">
                          <button
                            type="button"
                            onClick={() =>
                              setTxExpandedId(
                                txExpandedId === ev.id ? null : ev.id,
                              )
                            }
                            className="text-xs text-blue-600 hover:underline"
                          >
                            {txExpandedId === ev.id ? 'Hide' : 'View'} raw
                          </button>
                        </td>
                      </tr>
                      {txExpandedId === ev.id && (
                        <tr>
                          <td colSpan={6} className="pb-3">
                            <pre className="max-h-64 overflow-auto rounded bg-gray-50 p-2 text-xs">
                              {JSON.stringify(ev.raw, null, 2)}
                            </pre>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {txUser && txEvents.length === 0 && (
            <p className="text-sm text-gray-500">
              No bookings, wallet activity, or withdrawals found for this
              person.
            </p>
          )}
        </div>
      )}

      {/* Platform withdrawal modal */}
      {showPlatformWithdraw && (
        <WithdrawModal
          available={appRevenue}
          onClose={() => setShowPlatformWithdraw(false)}
        />
      )}
    </div>
  );
}

function TabButton({
  active,
  onClick,
  label,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      onClick={onClick}
      className={`px-3 py-2 rounded ${
        active
          ? 'bg-black text-white'
          : 'bg-gray-200 hover:bg-gray-300'
      }`}
    >
      {label}
    </button>
  );
}

function KpiCard({
  label,
  value,
}: {
  label: string;
  value: number | string;
}) {
  return (
    <div className="rounded border bg-white p-4">
      <div className="text-sm text-gray-600">{label}</div>
      <div className="text-2xl font-bold">{value}</div>
    </div>
  );
}

/**
 * Format a createdAt value that might be:
 * - Firestore Timestamp
 * - number (ms)
 * - ISO/string
 */
function formatDateTime(val: any): string {
  if (!val) return '—';

  let date: Date | null = null;

  if (val?.toDate?.() instanceof Date) {
    date = val.toDate();
  } else if (typeof val === 'number') {
    date = new Date(val);
  } else if (typeof val === 'string') {
    const parsed = new Date(val);
    if (!isNaN(parsed.getTime())) date = parsed;
  }

  return date ? date.toLocaleString() : '—';
}

/**
 * Guess what the user signed up with (email or phone)
 * Falls back to "Unknown" if we can't tell.
 */
function inferSignupMethod(u: any): string {
  if (u.authProvider) {
    return u.authProvider;
  }

  const hasEmail = !!u.email;
  const hasPhone = !!(u.businessPhone || u.phone);

  if (hasEmail && hasPhone) return 'Email & Phone';
  if (hasEmail) return 'Email';
  if (hasPhone) return 'Phone';

  return 'Unknown';
}