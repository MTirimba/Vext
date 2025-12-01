'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuthState } from 'react-firebase-hooks/auth';
import { FaArrowLeft, FaBell, FaCheckCircle } from 'react-icons/fa';
import {
  collection,
  query,
  orderBy,
  onSnapshot,
  updateDoc,
  doc,
} from 'firebase/firestore';
import { auth, db } from '@/lib/firebase';

interface UserNotification {
  id: string;
  type?:
    | 'booking-accepted'
    | 'booking-rejected'
    | 'booking-reminder'
    | 'new-booking'
    | 'generic';
  bookingId?: string;
  bookingStatus?: string;
  bookingTime?: number;
  createdAt?: number;
  read?: boolean;
  message?: string;
  role?: 'client' | 'provider';
}

function formatNotificationTime(ts?: number) {
  if (!ts) return '';
  try {
    const d = new Date(ts);
    return d.toLocaleString(undefined, {
      day: 'numeric',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return '';
  }
}

function getNotificationTitle(n: UserNotification): string {
  switch (n.type) {
    case 'booking-accepted':
      return 'Your booking was accepted';
    case 'booking-rejected':
      return 'Your booking was rejected';
    case 'booking-reminder':
      return 'Upcoming booking reminder';
    case 'new-booking':
      return 'New client booking';
    default:
      return 'Booking update';
  }
}

function getNotificationSubtitle(n: UserNotification): string {
  if (n.message) return n.message;

  if (n.type === 'booking-reminder' && n.bookingTime) {
    const when = formatNotificationTime(n.bookingTime);
    return `You have a booking scheduled for ${when}.`;
  }

  if (n.bookingStatus) {
    return `Booking status: ${n.bookingStatus}`;
  }

  return 'Tap to view booking details.';
}

export default function NotificationsPage() {
  const router = useRouter();
  const [user, authLoading] = useAuthState(auth);

  const [notifications, setNotifications] = useState<UserNotification[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (authLoading) return;
    if (!user) {
      setNotifications([]);
      setLoading(false);
      return;
    }

    const ref = collection(db, 'users', user.uid, 'notifications');
    const qRef = query(ref, orderBy('createdAt', 'desc'));

    const unsub = onSnapshot(
      qRef,
      (snap) => {
        const items: UserNotification[] = snap.docs.map((d) => {
          const data = d.data() as any;
          return {
            ...data,
            id: d.id,
          };
        });
        setNotifications(items);
        setLoading(false);
      },
      (err) => {
        console.error('notifications page snapshot error', err);
        setLoading(false);
      },
    );

    return () => unsub();
  }, [user, authLoading]);

  const unreadCount = useMemo(
    () => notifications.filter((n) => !n.read).length,
    [notifications],
  );

  const handleBack = () => {
    router.back();
  };

  const handleOpenBooking = (n: UserNotification) => {
    if (!n.bookingId) return;

    const basePath =
      n.role === 'provider'
        ? '/creator/bookings'
        : '/bookings';

    router.push(`${basePath}?bookingId=${encodeURIComponent(n.bookingId)}`);
  };

  const handleMarkAllRead = async () => {
    if (!user) return;
    const unread = notifications.filter((n) => !n.read);
    if (!unread.length) return;

    try {
      await Promise.all(
        unread.map((n) =>
          updateDoc(
            doc(db, 'users', user.uid!, 'notifications', n.id),
            { read: true },
          ),
        ),
      );
    } catch (err) {
      console.error('mark all notifications read error', err);
    }
  };

  if (authLoading || loading) {
    return (
      <div className="min-h-screen bg-black text-white flex items-center justify-center">
        <p className="text-sm text-gray-300">Loading notifications…</p>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="min-h-screen bg-black text-white flex flex-col items-center justify-center px-4">
        <p className="text-sm text-gray-300 mb-4">
          Please sign in to view your notifications.
        </p>
        <button
          type="button"
          onClick={() => router.push('/')}
          className="px-4 py-2 rounded-full bg-white text-black text-sm font-semibold hover:bg-gray-200"
        >
          Go to feed
        </button>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-black text-white">
      <div className="max-w-3xl mx-auto pt-4 px-3 pb-8">
        {/* Top bar */}
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleBack}
              className="flex items-center justify-center w-9 h-9 rounded-full bg-neutral-900 hover:bg-neutral-800 border border-white/10"
            >
              <FaArrowLeft className="text-sm" />
            </button>
            <div className="flex flex-col">
              <div className="flex items-center gap-2">
                <FaBell className="text-sm" />
                <h1 className="text-sm sm:text-base font-semibold">
                  Notifications
                </h1>
                {unreadCount > 0 && (
                  <span className="inline-flex items-center justify-center min-w-[18px] h-4 px-1 rounded-full bg-green-500 text-[10px] font-semibold">
                    {unreadCount > 9 ? '9+' : unreadCount}
                  </span>
                )}
              </div>
              <p className="text-[11px] text-gray-400 mt-0.5">
                Booking updates, reminders & new client requests.
              </p>
            </div>
          </div>

          <button
            type="button"
            disabled={unreadCount === 0}
            onClick={handleMarkAllRead}
            className={`flex items-center gap-1 text-[11px] sm:text-xs px-3 py-1.5 rounded-full border ${
              unreadCount === 0
                ? 'border-white/10 text-gray-500 cursor-default'
                : 'border-emerald-400/60 text-emerald-300 hover:bg-emerald-500/10'
            }`}
          >
            <FaCheckCircle className="text-[11px]" />
            <span>Mark all as read</span>
          </button>
        </div>

        {/* List */}
        <div className="space-y-2">
          {notifications.length === 0 && (
            <div className="text-xs text-gray-500 text-center mt-8">
              You don&apos;t have any notifications yet.
            </div>
          )}

          {notifications.map((n) => {
            const isUnread = !n.read;
            const title = getNotificationTitle(n);
            const subtitle = getNotificationSubtitle(n);
            const time = formatNotificationTime(n.createdAt);

            return (
              <div
                key={n.id}
                className={`rounded-xl border border-white/10 px-3 py-2.5 text-xs sm:text-sm cursor-pointer transition ${
                  isUnread ? 'bg-white/10' : 'bg-neutral-900/80'
                } hover:bg-white/15`}
                onClick={() => handleOpenBooking(n)}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p
                        className={`truncate ${
                          isUnread ? 'font-semibold' : 'font-normal'
                        }`}
                      >
                        {title}
                      </p>
                      {isUnread && (
                        <span className="w-2 h-2 rounded-full bg-emerald-400 shrink-0" />
                      )}
                    </div>
                    {subtitle && (
                      <p className="mt-1 text-[11px] text-gray-300 line-clamp-2">
                        {subtitle}
                      </p>
                    )}
                    {time && (
                      <p className="mt-1 text-[10px] text-gray-500">
                        {time}
                      </p>
                    )}
                  </div>

                  {n.bookingId && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleOpenBooking(n);
                      }}
                      className="text-[11px] px-2 py-1 rounded-full bg-emerald-500/20 border border-emerald-400/50 text-emerald-200 hover:bg-emerald-500/30 shrink-0"
                    >
                      View booking
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}