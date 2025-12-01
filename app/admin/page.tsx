'use client';

import { useEffect, useState } from 'react';
import { useAdminGate } from '@/components/useAdminGate';
import { db } from '@/lib/firebase';
import {
  collection,
  getCountFromServer,
  query,
  where,
  orderBy,
  limit,
  getDocs,
  doc,
  getDoc,
} from 'firebase/firestore';

type TabKey = 'overview' | 'users' | 'creators' | 'bookings' | 'content' | 'finance';

export default function AdminPage() {
  const gate = useAdminGate();
  const [active, setActive] = useState<TabKey>('overview');

  const [loading, setLoading] = useState(true);
  const [kpi, setKpi] = useState({ users: 0, creators: 0, bookings: 0, gmv: 0 });
  const [recentBookings, setRecentBookings] = useState<any[]>([]);

  // Per-tab data
  const [users, setUsers] = useState<any[]>([]);
  const [creators, setCreators] = useState<any[]>([]);
  const [bookings, setBookings] = useState<any[]>([]);
  const [videos, setVideos] = useState<any[]>([]);

  // ---------- Initial load: KPIs + recent bookings (with joined names)
  useEffect(() => {
    if (gate !== 'ok') return;
    (async () => {
      setLoading(true);

      const usersRef = collection(db, 'users');
      const creatorsQ = query(usersRef, where('isProvider', '==', true));
      const bookingsRef = collection(db, 'bookings');

      const [usersCountSnap, creatorsCountSnap, bookingsCountSnap] = await Promise.all([
        getCountFromServer(usersRef),
        getCountFromServer(creatorsQ),
        getCountFromServer(bookingsRef),
      ]);

      // GMV (no orderBy to avoid composite index requirement)
      // Sum totals for accepted/completed
      const gmvQ = query(bookingsRef, where('status', 'in', ['accepted', 'completed']));
      const gmvSnap = await getDocs(gmvQ);
      let gmv = 0;
      gmvSnap.forEach((d) => {
        const t = Number((d.data() as any).total) || 0;
        gmv += t;
      });

      // Recent bookings (unfiltered → safe to order by createdAt)
      const recentQ = query(bookingsRef, orderBy('createdAt', 'desc'), limit(8));
      const recentSnap = await getDocs(recentQ);
      const rawRecent = recentSnap.docs.map((d) => ({ id: d.id, ...d.data() }));

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
        })
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

  // ---------- Lazy-load per tab
  useEffect(() => {
    if (gate !== 'ok') return;
    (async () => {
      if (active === 'users') {
        const snap = await getDocs(query(collection(db, 'users'), orderBy('createdAt', 'desc'), limit(25)));
        setUsers(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
      }
      if (active === 'creators') {
        const snap = await getDocs(query(collection(db, 'users'), where('isProvider', '==', true), limit(25)));
        setCreators(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
      }
      if (active === 'bookings') {
        const snap = await getDocs(query(collection(db, 'bookings'), orderBy('createdAt', 'desc'), limit(25)));
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
          })
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
        const snap = await getDocs(query(collection(db, 'videos'), orderBy('createdAt', 'desc'), limit(25)));
        const vids = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
        const ids = new Set<string>();
        vids.forEach((v: any) => v.userId && ids.add(v.userId));
        const cache: Record<string, any> = {};
        await Promise.all(
          Array.from(ids).map(async (uid) => {
            const us = await getDoc(doc(db, 'users', uid));
            if (us.exists()) cache[uid] = us.data();
          })
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
    })();
  }, [active, gate]);

  if (gate === 'loading') return <p>Checking admin access…</p>;
  if (gate === 'signedout') return <p>Please sign in to access admin.</p>;
  if (gate === 'forbidden') return <p>Forbidden: admin access required.</p>;

  // Finance derived numbers (assuming +10% markup included in GMV)
  const appRevenue = Math.round(kpi.gmv * (10 / 110)); // platform 10% of client-paid total
  const providerEarnings = Math.max(0, kpi.gmv - appRevenue);

  return (
    <div>
      {/* Page-level tabs only (layout nav removed) */}
      <div className="mb-4 flex items-center gap-2">
        <TabButton active={active === 'overview'} onClick={() => setActive('overview')} label="Overview" />
        <TabButton active={active === 'users'} onClick={() => setActive('users')} label="Users" />
        <TabButton active={active === 'creators'} onClick={() => setActive('creators')} label="Creators" />
        <TabButton active={active === 'bookings'} onClick={() => setActive('bookings')} label="Bookings" />
        <TabButton active={active === 'content'} onClick={() => setActive('content')} label="Content" />
        <TabButton active={active === 'finance'} onClick={() => setActive('finance')} label="Finance" />
      </div>

      {/* Dynamic content area */}
      {active === 'overview' && (
        <div>
          <div className="grid grid-cols-1 sm:grid-cols-4 gap-4 mb-6">
            <KpiCard label="Users" value={kpi.users} />
            <KpiCard label="Creators" value={kpi.creators} />
            <KpiCard label="Bookings" value={kpi.bookings} />
            <KpiCard label="GMV (KSHS)" value={kpi.gmv.toLocaleString()} />
          </div>

          {loading ? (
            <p>Loading…</p>
          ) : (
            <>
              <h2 className="text-xl font-semibold mb-3">Recent bookings</h2>
              <div className="space-y-2">
                {recentBookings.map((b) => (
                  <div key={b.id} className="border rounded p-3 flex items-center justify-between">
                    <div className="text-sm">
                      <div className="font-semibold">#{b.shortId || b.id}</div>
                      <div className="text-gray-800">
                        <span className="font-medium">{b.clientName}</span>
                        {' '}→{' '}
                        <span className="font-medium">{b.providerName}</span>
                      </div>
                      <div className="text-gray-600">
                        {b.date ? new Date(b.date).toLocaleString() : '-'} • {b.status || 'pending'}
                      </div>
                    </div>
                    <div className="text-right text-sm">
                      <div>KSHS {Number(b.total || 0).toLocaleString()}</div>
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
          <h2 className="text-xl font-semibold mb-3">Users (latest)</h2>
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="text-left border-b">
                  <th className="py-2 pr-4">Full Name</th>
                  <th className="py-2 pr-4">Username</th>
                  <th className="py-2 pr-4">Email</th>
                  <th className="py-2 pr-4">Role</th>
                  <th className="py-2 pr-4">Provider?</th>
                </tr>
              </thead>
              <tbody>
                {users.map((u) => (
                  <tr key={u.id} className="border-b last:border-0">
                    <td className="py-2 pr-4">{u.fullName || u.name || '-'}</td>
                    <td className="py-2 pr-4">{u.username || '-'}</td>
                    <td className="py-2 pr-4">{u.email || '-'}</td>
                    <td className="py-2 pr-4">{u.role || '-'}</td>
                    <td className="py-2 pr-4">{u.isProvider ? 'Yes' : 'No'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {active === 'creators' && (
        <div>
          <h2 className="text-xl font-semibold mb-3">Creators</h2>
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="text-left border-b">
                  <th className="py-2 pr-4">Business / Name</th>
                  <th className="py-2 pr-4">Username</th>
                  <th className="py-2 pr-4">Phone</th>
                  <th className="py-2 pr-4">Town/County</th>
                </tr>
              </thead>
              <tbody>
                {creators.map((u) => (
                  <tr key={u.id} className="border-b last:border-0">
                    <td className="py-2 pr-4">{u.businessName || u.fullName || u.name || '-'}</td>
                    <td className="py-2 pr-4">{u.username || '-'}</td>
                    <td className="py-2 pr-4">{u.businessPhone || u.phone || '-'}</td>
                    <td className="py-2 pr-4">{[u.town, u.county].filter(Boolean).join(', ') || '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {active === 'bookings' && (
        <div>
          <h2 className="text-xl font-semibold mb-3">Bookings (latest)</h2>
          <div className="space-y-2">
            {bookings.map((b) => (
              <div key={b.id} className="border rounded p-3 flex items-center justify-between">
                <div className="text-sm">
                  <div className="font-semibold">#{b.shortId || b.id}</div>
                  <div className="text-gray-800">
                    <span className="font-medium">{b.clientName}</span>
                    {' '}→{' '}
                    <span className="font-medium">{b.providerName}</span>
                  </div>
                  <div className="text-gray-600">
                    {b.date ? new Date(b.date).toLocaleString() : '-'} • {b.status || 'pending'}
                  </div>
                </div>
                <div className="text-right text-sm">
                  <div>KSHS {Number(b.total || 0).toLocaleString()}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {active === 'content' && (
        <div>
          <h2 className="text-xl font-semibold mb-3">Content (latest)</h2>
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="text-left border-b">
                  <th className="py-2 pr-4">Title</th>
                  <th className="py-2 pr-4">Owner</th>
                  <th className="py-2 pr-4">Created</th>
                </tr>
              </thead>
              <tbody>
                {videos.map((v) => (
                  <tr key={v.id} className="border-b last:border-0">
                    <td className="py-2 pr-4">{v.title || '-'}</td>
                    <td className="py-2 pr-4">{v.ownerName || v.userId}</td>
                    <td className="py-2 pr-4">{v.createdAt ? new Date(v.createdAt).toLocaleString() : '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {active === 'finance' && (
        <div>
          <h2 className="text-xl font-semibold mb-3">Finance</h2>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <KpiCard label="GMV (KSHS)" value={kpi.gmv.toLocaleString()} />
            <KpiCard label="App revenue (KSHS)" value={appRevenue.toLocaleString()} />
            <KpiCard label="Provider earnings (KSHS)" value={providerEarnings.toLocaleString()} />
          </div>
          <p className="text-sm text-gray-600 mt-4">
            App revenue is estimated as <code>GMV × 10/110</code> assuming the client price includes a +10% platform
            markup and providers keep the full base price. If you later store <code>platformFee</code> per booking,
            we’ll sum that directly instead of estimating.
          </p>
        </div>
      )}
    </div>
  );
}

function TabButton({ active, onClick, label }: { active: boolean; onClick: () => void; label: string }) {
  return (
    <button
      onClick={onClick}
      className={`px-3 py-2 rounded ${active ? 'bg-black text-white' : 'bg-gray-200 hover:bg-gray-300'}`}
    >
      {label}
    </button>
  );
}

function KpiCard({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="p-4 rounded border bg-white">
      <div className="text-gray-600 text-sm">{label}</div>
      <div className="text-2xl font-bold">{value}</div>
    </div>
  );
}