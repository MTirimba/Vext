'use client';

import { useEffect, useState } from 'react';
import { collection, query, where, getDocs, updateDoc, doc, getDoc } from 'firebase/firestore';
import { db, auth } from '@/lib/firebase';
import { useAuthState } from 'react-firebase-hooks/auth';
import { FaWhatsapp, FaPhoneAlt } from 'react-icons/fa';

interface Booking {
  id: string;
  clientId: string;
  providerId: string;
  videoId?: string;
  date: string;
  time: string;
  total: number;
  status: string;
  addons?: Record<string, number>;
  clientPhone?: string;
  providerPhone?: string;
  clientName?: string;
  shortId?: string;
  completionPin?: string;    // optional, not usually visible to provider
  releaseVerified?: boolean; // true when PIN was successfully verified
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

export default function CreatorBookings() {
  const [user] = useAuthState(auth);
  const [bookings, setBookings] = useState<(Booking & { video?: Video; client?: UserProfile; provider?: UserProfile })[]>([]);

  const [searchOpen, setSearchOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');

  // 🔐 PIN entry + verification state (per booking)
  const [pinInputs, setPinInputs] = useState<Record<string, string>>({});
  const [verifyingId, setVerifyingId] = useState<string | null>(null);
  const [verifyMessages, setVerifyMessages] = useState<Record<string, string | null>>({});

  useEffect(() => {
    if (!user) return;

    (async () => {
      const qy = query(collection(db, 'bookings'), where('providerId', '==', user.uid));
      const snap = await getDocs(qy);

      const data = await Promise.all(
        snap.docs.map(async (d) => {
          const booking = { id: d.id, ...d.data() } as Booking;
          let video: Video | undefined;
          let client: UserProfile | undefined;
          let provider: UserProfile | undefined;

          if (booking.videoId) {
            const videoSnap = await getDoc(doc(db, 'videos', booking.videoId));
            if (videoSnap.exists()) {
              const vd = videoSnap.data() as Video & { url?: string; description?: string };
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
            const clientSnap = await getDoc(doc(db, 'users', booking.clientId));
            if (clientSnap.exists()) client = clientSnap.data() as UserProfile;
          }

          if (booking.providerId) {
            const providerSnap = await getDoc(doc(db, 'users', booking.providerId));
            if (providerSnap.exists()) provider = providerSnap.data() as UserProfile;
          }

          return { ...booking, video, client, provider };
        })
      );

      setBookings(data);
    })();
  }, [user]);

  const sendClientSMS = async (booking: Booking & { client?: UserProfile; provider?: UserProfile }) => {
    const clientDisplayName = booking.client?.fullName || booking.client?.name;
    if (!clientDisplayName || !booking.clientPhone) return;

    const dateStr = new Date(booking.date).toDateString();
    const timeStr = booking.time;
    const providerName = booking.provider?.name || booking.provider?.fullName || 'Service Provider';
    const locationDetails = `${booking.provider?.location || ''} ${booking.provider?.building || ''} ${booking.provider?.room || ''}`.trim();
    const mapsLink = booking.provider?.location ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(booking.provider.location)}` : '';

    const message = booking.status === 'accepted'
      ? `Hi ${clientDisplayName}, your booking #${booking.shortId || booking.id} has been ACCEPTED by ${providerName} for ${dateStr} at ${timeStr}. Location: ${locationDetails}. Map: ${mapsLink}`
      : `Hi ${clientDisplayName}, your booking #${booking.shortId || booking.id} has been REJECTED by ${providerName}.`;

    await fetch('/api/send-sms', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ to: booking.clientPhone, message }),
    });
  };

  const updateStatus = async (id: string, status: 'accepted' | 'rejected' | 'completed') => {
    const booking = bookings.find(b => b.id === id);
    if (!booking) return;

    await updateDoc(doc(db, 'bookings', id), { status });
    setBookings(prev => prev.map(b => (b.id === id ? { ...b, status } : b)));

    if (status === 'accepted' || status === 'rejected') {
      await sendClientSMS({ ...booking, status });
    }
  };

  // 🔐 handle verifying the client's Service Release PIN
  const handleVerifyPin = async (booking: Booking & { client?: UserProfile; provider?: UserProfile }) => {
    const pin = (pinInputs[booking.id] || '').trim();
    if (!pin) {
      setVerifyMessages(prev => ({ ...prev, [booking.id]: 'Please enter the PIN provided by the client.' }));
      return;
    }

    try {
      setVerifyingId(booking.id);
      setVerifyMessages(prev => ({ ...prev, [booking.id]: null }));

      const res = await fetch('/api/verify-completion', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          bookingId: booking.id,
          pin,
          providerId: booking.providerId,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to verify PIN');
      }

      // Mark as releaseVerified locally for UX (wallet logic runs elsewhere)
      setBookings(prev =>
        prev.map(b => (b.id === booking.id ? { ...b, releaseVerified: true } : b))
      );
      setVerifyMessages(prev => ({
        ...prev,
        [booking.id]: 'PIN verified. Funds for this booking will reflect in your available balance.',
      }));
      setPinInputs(prev => ({ ...prev, [booking.id]: '' }));
    } catch (err: any) {
      setVerifyMessages(prev => ({
        ...prev,
        [booking.id]: err.message || 'Could not verify PIN. Check and try again.',
      }));
    } finally {
      setVerifyingId(null);
    }
  };

  // search helpers
  const norm = (s?: string) => (s || '').toLowerCase().trim();
  const needle = norm(searchTerm);
  const filtered = needle
    ? bookings.filter((b) => {
        const hay = [b.shortId, b.id, b.client?.fullName, b.client?.name, b.clientName].map(norm);
        return hay.some((h) => h.includes(needle));
      })
    : bookings;

  // tel & WhatsApp helpers
  const telHref = (n?: string) => (n ? `tel:${n.replace(/\s+/g, '')}` : '');
  const waHref = (n?: string) => {
    if (!n) return '';
    const digits = n.replace(/[^\d]/g, '');
    return digits ? `https://wa.me/${digits}` : '';
  };

  return (
    <div className="p-6">
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-2xl font-bold">Client Appointments</h1>
        <div className="flex items-center gap-2">
          {searchTerm && (
            <span className="text-sm text-gray-600">
              Filter: <span className="font-semibold">{searchTerm}</span>
              <button
                className="ml-2 text-blue-600 underline"
                onClick={() => setSearchTerm('')}
              >
                Clear
              </button>
            </span>
          )}
          <button
            onClick={() => setSearchOpen(true)}
            className="px-3 py-1.5 rounded bg-gray-800 text-white hover:bg-gray-700"
          >
            Search
          </button>
        </div>
      </div>

      {filtered.length === 0 && <p>No bookings found.</p>}

      {filtered.map((b) => {
        const clientNumber = b.clientPhone || b.client?.phone;
        const providerNumber = b.providerPhone || b.provider?.businessPhone || b.provider?.phone;

        return (
          <div key={b.id} className="border p-4 mb-4 rounded shadow">
            <div className="grid grid-cols-1 md:grid-cols-5 gap-4 items-start">
              <div className="md:col-span-3">
                {b.video && (
                  <>
                    <h2 className="text-lg font-semibold">{b.video.title}</h2>
                    {b.video.details && <p className="text-gray-700">{b.video.details}</p>}
                  </>
                )}

                <p className="mt-2"><strong>Booking ID:</strong> {b.shortId || b.id}</p>
                <p>
                  <strong>Client:</strong>{' '}
                  {b.client?.fullName || b.client?.name || b.clientId}
                </p>

                {/* phones with icons */}
                <div className="mt-2 space-y-1 text-sm">
                  {clientNumber && (
                    <div className="flex items-center gap-2">
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
                    </div>
                  )}

                  {providerNumber && (
                    <div className="flex items-center gap-2">
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
                    </div>
                  )}
                </div>

                <p className="mt-2"><strong>Date:</strong> {new Date(b.date).toLocaleDateString()}</p>
                <p><strong>Time:</strong> {b.time}</p>
                <p><strong>Total:</strong> KSHS {b.total}</p>

                {b.addons && Object.keys(b.addons).length > 0 && (
                  <div className="mt-2">
                    <strong>Add-ons:</strong>
                    <ul className="list-disc list-inside">
                      {Object.entries(b.addons).map(([name, qty]) => (
                        <li key={name}>{name} × {qty}</li>
                      ))}
                    </ul>
                  </div>
                )}

                <p className="mt-2"><strong>Status:</strong> {b.status}</p>

                {b.status === 'pending' && (
                  <div className="flex space-x-2 mt-3">
                    <button
                      onClick={() => updateStatus(b.id, 'accepted')}
                      className="bg-green-500 text-white px-3 py-1 rounded"
                    >
                      Accept
                    </button>
                    <button
                      onClick={() => updateStatus(b.id, 'rejected')}
                      className="bg-red-500 text-white px-3 py-1 rounded"
                    >
                      Reject
                    </button>
                  </div>
                )}

                {b.status === 'accepted' && (
                  <button
                    onClick={() => updateStatus(b.id, 'completed')}
                    className="mt-3 bg-blue-500 text-white px-3 py-1 rounded"
                  >
                    Mark as Completed
                  </button>
                )}

                {/* 🔐 Service Release PIN entry (for funds to reflect) */}
                {(b.status === 'accepted' || b.status === 'completed') && (
                  <div className="mt-4 border-t pt-3">
                    <label className="block text-sm font-medium mb-1">
                      Client&apos;s Service Release PIN
                    </label>
                    <input
                      type="text"
                      maxLength={4}
                      value={pinInputs[b.id] || ''}
                      onChange={(e) =>
                        setPinInputs((prev) => ({ ...prev, [b.id]: e.target.value }))
                      }
                      placeholder="e.g. 4832"
                      className="border rounded px-2 py-1 text-sm w-40"
                    />
                    <button
                      onClick={() => handleVerifyPin(b)}
                      disabled={verifyingId === b.id || !(pinInputs[b.id] || '').trim()}
                      className="ml-2 px-3 py-1 rounded bg-green-600 text-white text-sm disabled:bg-gray-400"
                    >
                      {verifyingId === b.id ? 'Verifying…' : 'Verify PIN & Release Funds'}
                    </button>
                    <p className="text-xs text-gray-600 mt-1">
                      Ask the client for their Service Release PIN after you have delivered the
                      service. Enter it here so that the funds for this booking can reflect
                      in your account.
                    </p>
                    {b.releaseVerified && (
                      <p className="text-xs text-green-600 mt-1">
                        PIN verified. Funds for this booking are eligible in your available balance.
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
                ) : (b.video?.thumbnailUrl || b.video?.imageUrl) ? (
                  <img
                    src={b.video.thumbnailUrl || b.video.imageUrl}
                    alt={b.video.title || 'Booking Media'}
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
      })}

      {searchOpen && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
          <div className="bg-white text-black rounded-lg p-4 w-[90vw] max-w-md shadow-lg relative">
            <button onClick={() => setSearchOpen(false)} className="text-xl absolute top-2 right-3">×</button>
            <h2 className="text-lg font-semibold mb-3">Search Bookings</h2>
            <p className="text-sm text-gray-600 mb-2">
              Search by <strong>Booking ID / Short ID</strong> or <strong>Client Name</strong>.
            </p>
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="e.g. 9AB12, Jane Doe"
              className="w-full border rounded px-3 py-2 mb-3"
              autoFocus
            />
            <div className="flex justify-end siyaas gap-2">
              <button
                onClick={() => { setSearchTerm(''); setSearchOpen(false); }}
                className="px-3 py-1.5 rounded bg-gray-200"
              >
                Clear
              </button>
              <button
                onClick={() => setSearchOpen(false)}
                className="px-3 py-1.5 rounded bg-blue-600 text-white"
              >
                Apply
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}