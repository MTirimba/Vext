// /workspaces/Vext/components/VideoFeed.tsx
'use client';

import { useEffect, useState, useRef, useMemo } from 'react';
import {
  collection,
  getDocs,
  query,
  orderBy,
  doc,
  getDoc,
  deleteDoc,
  setDoc,
  onSnapshot,
  limit,
  updateDoc,
  where,
} from 'firebase/firestore';
import { db, auth } from '../lib/firebase';
import { useAuthState } from 'react-firebase-hooks/auth';
import {
  FaChevronDown,
  FaChevronUp,
  FaChevronLeft,
  FaChevronRight,
  FaHeart,
  FaRegHeart,
  FaCommentDots,
  FaShare,
  FaUserPlus,
  FaUserCheck,
  FaSearch,
  FaTimes,
  FaImages,
  FaSlidersH,
  FaBell,
  FaWhatsapp,
  FaFacebook,
  FaTwitter,
  FaEnvelope,
  FaInstagram,
} from 'react-icons/fa';
import { SiTiktok } from 'react-icons/si';
import { useRouter } from 'next/navigation';
import { CommentModal } from './CommentModal';
import BookingModal from './BookingModal';
import { EditVideoModal } from './EditVideoModal';
import AuthModal from './AuthModal';

// 🧠 feed ranking
import {
  rankVideos,
  signalsFromLocalStorage,
  type VideoDoc as AlgoVideoDoc,
} from '@/lib/feedAlgo';

// Shared config types
import {
  type CategoryId,
  type HairColorId,
  type NailShapeId,
} from '@/lib/serviceConfig';

// Filters dropdown component
import ServiceFiltersDropdown, {
  type FeedFilters,
} from './ServiceFiltersDropdown';

// ---------- markup config (tiered) ----------

interface MarkupTier {
  min: number;
  max: number | null; // null = open-ended
  percent: number; // e.g. 10 = 10%
}

interface MarkupConfig {
  tiers: MarkupTier[];
}

// Default tiers (used if config/pricing missing or invalid)
// 1–1500  → 10%
// 1500–5000 → 5%
// 5000–10000 → 2.5%
// 10000+ → 2%
const DEFAULT_MARKUP_CONFIG: MarkupConfig = {
  tiers: [
    { min: 0, max: 1500, percent: 10 },
    { min: 1500, max: 5000, percent: 5 },
    { min: 5000, max: 10000, percent: 2.5 },
    { min: 10000, max: null, percent: 2 },
  ],
};

function getMarkupPercent(basePrice: number, config?: MarkupConfig | null) {
  const cfg = config && config.tiers?.length ? config : DEFAULT_MARKUP_CONFIG;
  const tier = cfg.tiers.find(
    (t) => basePrice >= t.min && (t.max == null || basePrice <= t.max),
  );
  return tier ? tier.percent : 0;
}

function applyMarkup(basePrice: number, config?: MarkupConfig | null) {
  const pct = getMarkupPercent(basePrice, config);
  return Math.round(basePrice * (1 + pct / 100));
}

// --- types
interface MediaItem {
  url: string;
  type?: 'image' | 'video';
  name?: string;
}

interface VideoDoc {
  url: string; // legacy primary url
  title?: string;
  description?: string;
  userId?: string;
  serviceCost?: number;
  addons?: { name: string; cost: number; unit: string }[];
  id: string;
  videoId?: string;

  // NEW: createdAt for freshness (if present on your doc)
  createdAt?: number;

  // carousel fields
  media?: MediaItem[];
  hasCarousel?: boolean;
  coverUrl?: string;
  specialInstructions?: string | null;

  // NEW: discovery metadata (from UploadModal)
  categoryId?: CategoryId | string;
  categoryLabel?: string;
  subcategoryId?: string;
  subcategoryLabel?: string;

  targetGender?: string | null;
  targetAgeGroup?: string | null;

  hairColors?: string[]; // ids like "black", "blonde"
  nailShapes?: string[]; // ids like "oval", "stiletto"
  nailLength?: string | null;

  locationTag?: string | null; // e.g. "My Salon, Westlands, Nairobi"
}

interface UserProfile {
  username?: string;
  personalUsername?: string;
  businessUsername?: string;
  profilePhoto?: string;
  businessProfilePhoto?: string;
  isServiceProvider?: boolean;
  location?: string;
  businessName?: string;

  // optional extra metadata used by filters
  town?: string;
  county?: string;
  gender?: string;
  targetGender?: string;
  targetAgeGroup?: string;
}

/** Basic notification model coming from Firestore */
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

/* ---------------- helpers ---------------- */

function normalizeHandle(v?: string | null) {
  return (v || '').trim().toLowerCase();
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

export default function VideoFeed() {
  const [user] = useAuthState(auth);
  const [videos, setVideos] = useState<VideoDoc[]>([]);
  const [allVideos, setAllVideos] = useState<VideoDoc[]>([]);
  const [userProfiles, setUserProfiles] = useState<Record<string, UserProfile>>(
    {},
  );
  const [likesMap, setLikesMap] = useState<Record<string, boolean>>({});
  const [followMap, setFollowMap] = useState<Record<string, boolean>>({});
  const [commentVideo, setCommentVideo] = useState<string | null>(null);
  const [bookingVideo, setBookingVideo] = useState<VideoDoc | null>(null);
  const [editingVideo, setEditingVideo] = useState<VideoDoc | null>(null);

  // NEW: share modal state
  const [shareVideo, setShareVideo] = useState<VideoDoc | null>(null);

  // NEW: markup config state
  const [markupConfig, setMarkupConfig] = useState<MarkupConfig | null>(null);

  const sliderRef = useRef<HTMLDivElement | null>(null);
  const sliderInstanceRef = useRef<any>(null);
  const [isSliderReady, setIsSliderReady] = useState(false);

  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [authDialogOpen, setAuthDialogOpen] = useState(false);
  const [isProvider, setIsProvider] = useState(false);
  const [username, setUsername] = useState('');
  const router = useRouter();

  // 🔔 notifications
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [notifications, setNotifications] = useState<UserNotification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);

  // 💬 messages (unread conversations count)
  const [unreadMessagesCount, setUnreadMessagesCount] = useState(0);

  // 🔎 slide-out search UI state
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');

  // 🧩 Track current vertical index
  const [currentIndex, setCurrentIndex] = useState(0);

  // 🧭 Per-post carousel index (postId → index)
  const [mediaIndexMap, setMediaIndexMap] = useState<Record<string, number>>(
    {},
  );

  // 🖐️ Per-post touch positions for swipe
  const touchStartXRef = useRef<Record<string, number>>({});
  const touchStartYRef = useRef<Record<string, number>>({});

  // 🎯 Filters (used by sliders icon)
  const [filters, setFilters] = useState<FeedFilters>({
    gender: 'any',
    ageGroup: 'any',
    location: '',
    categories: [],
    hairColors: [],
    nailShapes: [],
    nailLength: 'any',
  });
  const [filtersOpen, setFiltersOpen] = useState(false);

  // aggregated attention flags
  const hasUnreadNotifications = unreadCount > 0;
  const hasUnreadMessages = unreadMessagesCount > 0;
  const hasAnyAttentionDot = hasUnreadNotifications || hasUnreadMessages;

  // Helpers
  const isImageUrl = (url: string) => {
    if (!url) return false;
    const u = url.split('?')[0].toLowerCase();
    return (
      /\.(png|jpe?g|gif|webp|avif|bmp)$/.test(u) || url.startsWith('data:image')
    );
  };

  const getMediaList = (v: VideoDoc): MediaItem[] => {
    if (v.media && v.media.length > 0) return v.media;
    return v.url
      ? [{ url: v.url, type: isImageUrl(v.url) ? 'image' : 'video' }]
      : [];
  };

  // establish slider ref
  useEffect(() => {
    if (sliderRef.current) {
      sliderInstanceRef.current = sliderRef.current;
      setIsSliderReady(true);
    }
  }, []);

  // 🔁 load markup config from Firestore (shared with admin)
  useEffect(() => {
    (async () => {
      try {
        const snap = await getDoc(doc(db, 'config', 'pricing'));
        if (snap.exists()) {
          const data = snap.data() as any;
          if (Array.isArray(data.tiers)) {
            const tiers: MarkupTier[] = data.tiers.map((t: any) => ({
              min: Number(t.min) || 0,
              max:
                typeof t.max === 'number'
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
        console.error('load markup config error', err);
      }
    })();
  }, []);

  // intersection observer for auto-play
  useEffect(() => {
    const root = sliderRef.current;
    if (!root) return;
    const videosEls = Array.from(
      root.querySelectorAll('video'),
    ) as HTMLVideoElement[];
    videosEls.forEach((v) => v.pause());

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          const vid = entry.target as HTMLVideoElement;
          if (entry.isIntersecting && entry.intersectionRatio >= 0.6) {
            vid.play().catch(() => {});
            const idx = videosEls.indexOf(vid);
            if (idx >= 0) setCurrentIndex(idx);
          } else {
            vid.pause();
          }
        });
      },
      { root, threshold: [0, 0.6, 1] },
    );

    videosEls.forEach((v) => observer.observe(v));
    return () => observer.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [videos.map((v) => v.id).join('|')]);

  // custom wheel-scroll
  useEffect(() => {
    const el = sliderRef.current;
    if (!el) return;

    let wheelActive = false;
    let wheelTimeout: ReturnType<typeof setTimeout> | undefined;

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      if (wheelActive) return;
      wheelActive = true;

      if (e.deltaY > 0) scrollNext();
      else if (e.deltaY < 0) scrollPrev();

      clearTimeout(wheelTimeout);
      wheelTimeout = setTimeout(() => {
        wheelActive = false;
      }, 120);
    };

    el.addEventListener('wheel', onWheel, { passive: false });
    return () => {
      el.removeEventListener('wheel', onWheel as EventListener);
      clearTimeout(wheelTimeout);
    };
  });

  // ------------------------------
  // Fetch videos once (then rank)
  // ------------------------------
  useEffect(() => {
    (async () => {
      try {
        const snap = await getDocs(
          query(collection(db, 'videos'), orderBy('createdAt', 'desc')),
        );
        const docs = snap.docs.map((d) => ({
          ...(d.data() as VideoDoc),
          id: d.id,
        }));

        // keep raw pool
        setAllVideos(docs);

        // build initial ranking without follow signals (not yet loaded)
        const localSignals = signalsFromLocalStorage();

        const rankedInitial = rankVideos(
          docs as unknown as AlgoVideoDoc[],
          {
            userId: user?.uid,
            followsByCreatorId: {}, // filled later once we fetch followMap
            ...localSignals,
          },
          {
            freshnessHalfLifeHours: 24,
            maxClusterPerCreator: 2,
          },
        );

        // honor lastVideoId pin-to-top behavior
        const savedId =
          typeof window !== 'undefined'
            ? localStorage.getItem('lastVideoId')
            : null;
        let orderedVideos = rankedInitial as VideoDoc[];

        if (savedId) {
          const savedIndex = orderedVideos.findIndex((v) => v.id === savedId);
          if (savedIndex > -1) {
            const [found] = orderedVideos.splice(savedIndex, 1);
            orderedVideos = [found, ...orderedVideos];
          }
        }

        setVideos(orderedVideos);

        // scroll to saved after first paint
        if (savedId && sliderRef.current) {
          setTimeout(() => {
            const idx = orderedVideos.findIndex((v) => v.id === savedId);
            if (idx >= 0 && sliderRef.current) {
              const h = sliderRef.current.clientHeight || window.innerHeight;
              sliderRef.current.scrollTo({
                top: idx * h,
                behavior: 'auto',
              });
            }
          }, 600);
        }

        // fetch minimal creator profiles (for pills/booking)
        const uids = [...new Set(docs.map((v) => v.userId).filter(Boolean))];
        const profiles: Record<string, UserProfile> = {};
        await Promise.all(
          uids.map(async (id) => {
            const ps = await getDoc(doc(db, 'users', id!));
            if (ps.exists()) profiles[id!] = ps.data() as UserProfile;
          }),
        );
        setUserProfiles(profiles);
      } catch (err) {
        console.error('videos fetch error', err);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ------------------------------
  // Likes/Follows when user changes
  // ------------------------------
  useEffect(() => {
    if (!user || videos.length === 0) {
      if (!user) {
        setLikesMap({});
        setFollowMap({});
      }
      return;
    }

    (async () => {
      try {
        const lm: Record<string, boolean> = {};
        await Promise.all(
          videos.map(async (v) => {
            const ldoc = await getDoc(
              doc(db, 'videos', v.id, 'likes', user.uid!),
            );
            lm[v.id] = ldoc.exists();
          }),
        );
        setLikesMap(lm);

        const uids = [...new Set(videos.map((v) => v.userId).filter(Boolean))];
        const fl: Record<string, boolean> = {};
        await Promise.all(
          uids.map(async (id) => {
            const fdoc = await getDoc(
              doc(db, 'users', id!, 'followers', user.uid!),
            );
            fl[id!] = fdoc.exists();
          }),
        );
        setFollowMap(fl);
      } catch (err) {
        console.error('likes/follows fetch error', err);
      }
    })();
  }, [user, videos]);

  // re-rank once followMap is known (gives social boost)
  useEffect(() => {
    if (allVideos.length === 0) return;
    const localSignals = signalsFromLocalStorage();
    const ranked = rankVideos(
      allVideos as unknown as AlgoVideoDoc[],
      {
        userId: user?.uid,
        followsByCreatorId: followMap,
        ...localSignals,
      },
      {
        freshnessHalfLifeHours: 24,
        maxClusterPerCreator: 2,
      },
    ) as VideoDoc[];

    // keep current savedId on top if set
    const savedId =
      typeof window !== 'undefined'
        ? localStorage.getItem('lastVideoId')
        : null;
    let ordered = ranked;
    if (savedId) {
      const i = ordered.findIndex((v) => v.id === savedId);
      if (i > -1) {
        const [found] = ordered.splice(i, 1);
        ordered = [found, ...ordered];
      }
    }
    setVideos(ordered);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(followMap), allVideos.length]);

  // restore username/isProvider
  useEffect(() => {
    if (!user) return;
    getDoc(doc(db, 'users', user.uid)).then((snap) => {
      const data = snap.data() as any;
      if (data) {
        setIsProvider(!!data.isProvider);
        const personalHandle = data.personalUsername || data.username || '';
        setUsername(personalHandle);
      }
    });
  }, [user]);

  // 🔔 live notifications subscription
  useEffect(() => {
    if (!user) {
      setNotifications([]);
      setUnreadCount(0);
      return;
    }

    const notifRef = collection(db, 'users', user.uid, 'notifications');
    const q = query(notifRef, orderBy('createdAt', 'desc'), limit(50));

    const unsub = onSnapshot(
      q,
      (snap) => {
        const items: UserNotification[] = snap.docs.map((d) => ({
          ...(d.data() as any),
          id: d.id,
        }));
        setNotifications(items);
        const unread = items.filter((n) => !n.read).length;
        setUnreadCount(unread);
      },
      (err) => {
        console.error('notifications snapshot error', err);
      },
    );

    return () => unsub();
  }, [user]);

  // 💬 live unread messages subscription based on conversations/messages
  useEffect(() => {
    if (!user) {
      setUnreadMessagesCount(0);
      return;
    }

    // we track last message per conversation
    const lastMessageByConversation: Record<
      string,
      { sender?: string; read?: boolean }
    > = {};
    const messageUnsubs = new Map<string, () => void>();

    const convQ = query(
      collection(db, 'conversations'),
      where('participants', 'array-contains', user.uid),
      orderBy('createdAt', 'desc'),
    );

    const convUnsub = onSnapshot(
      convQ,
      (snap) => {
        const currentConvIds = new Set<string>();

        snap.docs.forEach((convDoc) => {
          const convId = convDoc.id;
          currentConvIds.add(convId);

          // set up last-message listener only once per conversation
          if (!messageUnsubs.has(convId)) {
            const messagesRef = collection(
              db,
              'conversations',
              convId,
              'messages',
            );
            const lastMsgQ = query(
              messagesRef,
              orderBy('createdAt', 'desc'),
              limit(1),
            );

            const msgUnsub = onSnapshot(
              lastMsgQ,
              (msgSnap) => {
                if (!msgSnap.empty) {
                  const lastMsg = msgSnap.docs[0].data() as {
                    sender?: string;
                    read?: boolean;
                  };
                  lastMessageByConversation[convId] = lastMsg;
                } else {
                  delete lastMessageByConversation[convId];
                }

                // recompute unread conversations:
                // last message exists, not sent by me, and read !== true
                let unreadConversations = 0;
                Object.entries(lastMessageByConversation).forEach(
                  ([, msg]) => {
                    if (
                      msg.sender &&
                      msg.sender !== user.uid &&
                      msg.read !== true
                    ) {
                      unreadConversations += 1;
                    }
                  },
                );
                setUnreadMessagesCount(unreadConversations);
              },
              (err) => {
                console.error('last message snapshot error', err);
              },
            );

            messageUnsubs.set(convId, msgUnsub);
          }
        });

        // clean up listeners for conversations that no longer exist
        for (const [convId, unsub] of messageUnsubs.entries()) {
          if (!currentConvIds.has(convId)) {
            unsub();
            messageUnsubs.delete(convId);
            delete lastMessageByConversation[convId];
          }
        }
      },
      (err) => {
        console.error('conversations snapshot error (messages)', err);
      },
    );

    return () => {
      convUnsub();
      messageUnsubs.forEach((u) => u());
    };
  }, [user]);

  // 🔔 when notifications modal opens, mark unread as read
  useEffect(() => {
    if (!notificationsOpen || !user) return;
    const unread = notifications.filter((n) => !n.read);
    if (!unread.length) return;

    unread.forEach(async (n) => {
      try {
        await updateDoc(
          doc(db, 'users', user.uid!, 'notifications', n.id),
          { read: true },
        );
      } catch (err) {
        console.error('mark notification read error', err);
      }
    });
  }, [notificationsOpen, notifications, user]);

  // restore lastVideoId position (if still in list)
  useEffect(() => {
    if (!user) return;
    const savedId =
      typeof window !== 'undefined'
        ? localStorage.getItem('lastVideoId')
        : null;
    if (!savedId) return;
    if (videos.length === 0) return;

    const idx = videos.findIndex((v) => v.id === savedId);
    if (idx >= 0 && sliderRef.current) {
      const h = sliderRef.current.clientHeight || window.innerHeight;
      sliderRef.current.scrollTo({ top: idx * h, behavior: 'auto' });
      setTimeout(() => {
        try {
          localStorage.removeItem('lastVideoId');
        } catch {}
      }, 200);
    } else {
      try {
        localStorage.removeItem('lastVideoId');
      } catch {}
    }
  }, [user, videos]);

  // infinite scroll – append from pool
  useEffect(() => {
    const el = sliderRef.current;
    if (!el || allVideos.length === 0) return;

    const threshold = 3 * (el.clientHeight || window.innerHeight);
    const handleScrollDown = () => {
      const { scrollTop, scrollHeight, clientHeight } = el;
      if (scrollHeight - (scrollTop + clientHeight) < threshold) {
        setVideos((prev) => [...prev, ...allVideos]);
      }
    };
    el.addEventListener('scroll', handleScrollDown);
    return () =>
      el.removeEventListener('scroll', handleScrollDown);
  }, [allVideos]);

  // infinite scroll – prepend
  useEffect(() => {
    const el = sliderRef.current;
    if (!el || allVideos.length === 0) return;

    const threshold = 3 * (el.clientHeight || window.innerHeight);
    const handleScrollUp = () => {
      const { scrollTop, clientHeight } = el;
      if (scrollTop < threshold) {
        setVideos((prev) => [...allVideos, ...prev]);
        const addedHeight = allVideos.length * clientHeight;
        el.scrollTop += addedHeight;
      }
    };
    el.addEventListener('scroll', handleScrollUp);
    return () =>
      el.removeEventListener('scroll', handleScrollUp);
  }, [allVideos]);

  const handleSignOut = async () => {
    await auth.signOut();
    setDropdownOpen(false);
    router.push('/');
  };

  const handleLike = async (videoId: string) => {
    if (!user) return alert('Sign in to like');
    const refDoc = doc(db, 'videos', videoId, 'likes', user.uid!);
    if (likesMap[videoId]) await deleteDoc(refDoc);
    else await setDoc(refDoc, { likedAt: Date.now(), userId: user.uid });
    setLikesMap((prev) => ({ ...prev, [videoId]: !prev[videoId] }));
  };

  const handleFollow = async (creatorId: string) => {
    if (!user) return alert('Sign in to follow');
    const refDoc = doc(db, 'users', creatorId, 'followers', user.uid!);
    if (followMap[creatorId]) await deleteDoc(refDoc);
    else
      await setDoc(refDoc, {
        followedAt: Date.now(),
        userId: user.uid,
      } as any);
    setFollowMap((prev) => ({
      ...prev,
      [creatorId]: !prev[creatorId],
    }));
  };

  const handleDelete = async (videoId: string) => {
    if (!confirm('Are you sure you want to delete this upload?')) return;
    await deleteDoc(doc(db, 'videos', videoId));
    setVideos((prev) => prev.filter((v) => v.id !== videoId));
    setAllVideos((prev) => prev.filter((v) => v.id !== videoId));

    try {
      await fetch('/api/algolia/deleteVideo', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: videoId }),
      });
    } catch (e) {
      console.warn(
        'Algolia delete failed (will disappear on next reindex):',
        e,
      );
    }
  };

  const getCurrentIndex = (el: HTMLDivElement) => {
    const h = el.clientHeight || window.innerHeight;
    return Math.round(el.scrollTop / h);
  };

  // ---------- client-side search + filters wired to new fields ----------

  const filteredVideos = useMemo(() => {
    const term = searchTerm.trim().toLowerCase();

    return videos.filter((v) => {
      const provider = userProfiles[v.userId || ''];

      // 1) TEXT SEARCH
      if (term) {
        const haystack = [
          v.title,
          v.description,
          provider?.businessName,
          provider?.location,
          provider?.town,
          provider?.county,
          v.locationTag || undefined,
          v.categoryLabel,
          v.subcategoryLabel,
        ]
          .filter(Boolean)
          .join(' ')
          .toLowerCase();

        if (!haystack.includes(term)) {
          return false;
        }
      }

      // 2) CATEGORY filter (multi-select)
      if (filters.categories.length) {
        const catId = (v.categoryId || '').toString() as
          | CategoryId
          | '';
        if (!catId || !filters.categories.includes(catId as CategoryId)) {
          return false;
        }
      }

      // 3) GENDER filter
      if (filters.gender !== 'any') {
        let videoGender = '';

        if (typeof v.targetGender === 'string') {
          videoGender = v.targetGender.toLowerCase();
        } else if (typeof provider?.targetGender === 'string') {
          videoGender = provider.targetGender.toLowerCase();
        } else if (typeof provider?.gender === 'string') {
          videoGender = provider.gender.toLowerCase();
        }

        if (!videoGender) return false;

        const wanted = filters.gender.toLowerCase();
        if (['male', 'female', 'unisex'].includes(videoGender)) {
          if (videoGender !== wanted) return false;
        } else if (!videoGender.includes(wanted)) {
          return false;
        }
      }

      // 4) AGE GROUP filter
      if (filters.ageGroup !== 'any') {
        let age = '';

        if (typeof v.targetAgeGroup === 'string') {
          age = v.targetAgeGroup.toLowerCase();
        } else if (typeof (v as any).ageGroup === 'string') {
          age = (v as any).ageGroup.toLowerCase();
        } else if (typeof provider?.targetAgeGroup === 'string') {
          age = provider.targetAgeGroup.toLowerCase();
        }

        if (!age) return false;

        const wanted = filters.ageGroup.toLowerCase();
        if (['kids', 'adults', 'all'].includes(age)) {
          if (age !== wanted) return false;
        } else if (!age.includes(wanted)) {
          return false;
        }
      }

      // 5) HAIR COLOR filter (multi-select)
      if (filters.hairColors.length) {
        const vidColors = Array.isArray(v.hairColors) ? v.hairColors : [];
        if (
          !vidColors.some((c) =>
            filters.hairColors.includes(c as HairColorId),
          )
        ) {
          return false;
        }
      }

      // 6) NAIL SHAPE filter (multi-select)
      if (filters.nailShapes.length) {
        const vidShapes = Array.isArray(v.nailShapes) ? v.nailShapes : [];
        if (
          !vidShapes.some((s) =>
            filters.nailShapes.includes(s as NailShapeId),
          )
        ) {
          return false;
        }
      }

      // 7) NAIL LENGTH filter
      if (filters.nailLength !== 'any') {
        const length = (v.nailLength || '').toString();
        if (!length || length !== filters.nailLength) {
          return false;
        }
      }

      // 8) LOCATION filter
      if (filters.location.trim()) {
        const needle = filters.location.trim().toLowerCase();
        const locFields = [
          v.locationTag || undefined,
          provider?.businessName,
          provider?.location,
          provider?.town,
          provider?.county,
        ]
          .filter(Boolean)
          .join(' ')
          .toLowerCase();

        if (!locFields.includes(needle)) {
          return false;
        }
      }

      return true;
    });
  }, [videos, userProfiles, filters, searchTerm]);

  const scrollNext = () => {
    const el = sliderRef.current;
    if (!el || filteredVideos.length === 0) return;
    const h = el.clientHeight || window.innerHeight;
    const idx = getCurrentIndex(el);
    el.scrollTo({ top: (idx + 1) * h, behavior: 'smooth' });
  };

  const scrollPrev = () => {
    const el = sliderRef.current;
    if (!el || filteredVideos.length === 0) return;
    const h = el.clientHeight || window.innerHeight;
    const idx = getCurrentIndex(el);
    el.scrollTo({ top: (idx - 1) * h, behavior: 'smooth' });
  };

  const togglePlay = (e: React.MouseEvent<HTMLVideoElement>) => {
    const v = e.currentTarget;
    v.paused ? v.play().catch(() => {}) : v.pause();
  };

  // NEW: open share modal for this post
  const handleShare = (video: VideoDoc) => {
    setShareVideo(video);
  };

  const openAuthModal = () => {
    if (filteredVideos[currentIndex]) {
      try {
        localStorage.setItem('lastVideoId', filteredVideos[currentIndex].id);
      } catch {}
    }
    setAuthDialogOpen(true);
  };

  // carousel helpers
  const setMediaIndex = (postId: string, idx: number) =>
    setMediaIndexMap((prev) => ({ ...prev, [postId]: idx }));

  // 🔎 trigger navigation to /search when user presses Enter or clicks icon
  const triggerSearch = () => {
    const q = searchTerm.trim();
    if (!q) return;
    router.push(`/search?q=${encodeURIComponent(q)}`);
  };

  const handleClearFilters = () => {
    setFilters({
      gender: 'any',
      ageGroup: 'any',
      location: '',
      categories: [],
      hairColors: [],
      nailShapes: [],
      nailLength: 'any',
    });
  };

  const handleClearSearchAndFilters = () => {
    setSearchTerm('');
    handleClearFilters();
  };

  const anyFilterActive =
    filters.gender !== 'any' ||
    filters.ageGroup !== 'any' ||
    filters.location.trim().length > 0 ||
    filters.categories.length > 0 ||
    filters.hairColors.length > 0 ||
    filters.nailShapes.length > 0 ||
    filters.nailLength !== 'any' ||
    searchTerm.trim().length > 0;

  const handleOpenBookingFromNotification = (n: UserNotification) => {
    if (!n.bookingId) return;
    const basePath =
      isProvider || n.role === 'provider'
        ? '/creator/bookings'
        : '/bookings';

    router.push(`${basePath}?bookingId=${encodeURIComponent(n.bookingId)}`);
    setNotificationsOpen(false);
  };

  return (
    <div className="relative h-screen w-full bg-black text-white overflow-hidden">
      {/* Top-right controls */}
      <div className="absolute top-3 right-3 z-50 flex items-center space-x-2">
        {/* Inline search */}
        <div
          className={`flex items-center transition-all duration-300 ${
            searchOpen ? 'w-64 sm:w-80' : 'w-8'
          }`}
        >
          {/* Search / close icon */}
          <button
            type="button"
            onClick={() => {
              if (searchOpen && searchTerm.trim()) {
                // run full search page
                triggerSearch();
              } else {
                const next = !searchOpen;
                setSearchOpen(next);
                if (!next) setSearchTerm('');
              }
            }}
            className="h-8 w-8 flex items-center justify-center text-white hover:text-gray-300 transition"
            aria-label={searchOpen ? 'Close search' : 'Open search'}
          >
            {searchOpen ? <FaTimes /> : <FaSearch />}
          </button>

          {/* Expanding input */}
          {searchOpen && (
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  triggerSearch();
                }
              }}
              placeholder="Search services…"
              className="flex-1 bg-gray-900/90 text-white placeholder-gray-400 px-3 py-2 rounded-r-full outline-none text-sm"
            />
          )}
        </div>

        {/* Filter icon (no background) */}
        <button
          type="button"
          onClick={() => setFiltersOpen((prev) => !prev)}
          className="h-8 w-8 flex items-center justify-center text-white hover:text-gray-300 transition"
          aria-label="Filter services"
        >
          <FaSlidersH />
        </button>

        {/* Avatar / menu with attention dot */}
        <div className="relative">
          <button
            onClick={() => setDropdownOpen(!dropdownOpen)}
            className="focus:outline-none relative"
          >
            {user?.photoURL ? (
              <img
                src={user.photoURL}
                alt="profile"
                className="w-9 h-9 rounded-full object-cover border border-white/40"
              />
            ) : (
              <div className="w-9 h-9 bg-gray-400 rounded-full flex items-center justify-center">
                <span className="text-white font-medium">U</span>
              </div>
            )}

            {hasAnyAttentionDot && (
              <span className="absolute -top-0.5 -right-0.5 w-3 h-3 rounded-full bg-emerald-400 border border-black" />
            )}
          </button>

          {dropdownOpen && (
            <div className="absolute right-0 mt-2 w-52 bg-gray-900 rounded-lg shadow-lg p-2 text-white text-sm">
              {user ? (
                <>
                  <div className="flex items-center space-x-2 p-1 mb-2 bg-gray-800 rounded">
                    {user.photoURL ? (
                      <img
                        src={user.photoURL}
                        alt="Avatar"
                        className="w-8 h-8 rounded-full object-cover"
                      />
                    ) : (
                      <div className="w-8 h-8 bg-gray-600 rounded-full flex items-center justify-center">
                        <span className="text-white">U</span>
                      </div>
                    )}
                    <span className="font-semibold truncate">@{username}</span>
                  </div>

                  {/* Notifications entry */}
                  <button
                    onClick={() => {
                      setNotificationsOpen(true);
                      setDropdownOpen(false);
                    }}
                    className="block w-full px-2 py-1 hover:bg-gray-700 rounded mb-1 flex items-center"
                  >
                    <span className="relative inline-flex items-center gap-2 text-sm">
                      <FaBell className="text-xs" />
                      <span>Notifications</span>
                    </span>
                    {unreadCount > 0 && (
                      <span className="absolute -top-1 -right-1 flex h-3 w-3 items-center justify-center rounded-full bg-green-500 text-[8px] font-semibold">
                        {unreadCount > 9 ? '9+' : unreadCount}
                      </span>
                    )}
                  </button>

                  {/* Messages entry (below notifications) */}
                  <button
                    onClick={() => {
                      router.push('/messages');
                      setDropdownOpen(false);
                    }}
                    className="block w-full px-2 py-1 hover:bg-gray-700 rounded mb-1 flex items-center"
                  >
                    <span className="relative inline-flex items-center gap-2 text-sm">
                      <FaCommentDots className="text-xs" />
                      <span>Messages</span>
                    </span>
                    {unreadMessagesCount > 0 && (
                      <span className="absolute -top-1 -right-1 flex h-3 w-3 items-center justify-center rounded-full bg-green-400 text-[8px] font-semibold">
                        {unreadMessagesCount > 1
                          ? unreadMessagesCount > 9
                            ? '9+'
                            : unreadMessagesCount
                          : ''}
                      </span>
                    )}
                  </button>

                  {isProvider && (
                    <>
                      <button
                        onClick={() => {
                          router.push('/upload');
                          setDropdownOpen(false);
                        }}
                        className="block w-full px-2 py-1 hover:bg-gray-700 rounded mb-1"
                      >
                        Upload
                      </button>
                      <button
                        onClick={() => {
                          router.push('/provider/dashboard');
                          setDropdownOpen(false);
                        }}
                        className="block w-full px-2 py-1 hover:bg-gray-700 rounded mb-1"
                      >
                        Provider Dashboard
                      </button>

                      <button
                        onClick={() => {
                          router.push('/creator/bookings');
                          setDropdownOpen(false);
                        }}
                        className="block w-full px-2 py-1 hover:bg-gray-700 rounded mb-1"
                      >
                        Client Bookings
                      </button>
                      <button
                        onClick={() => {
                          router.push('/bookings');
                          setDropdownOpen(false);
                        }}
                        className="block w-full px-2 py-1 hover:bg-gray-700 rounded mb-1"
                      >
                        My Bookings
                      </button>
                      <button
                        onClick={() => {
                          router.push('/wallet');
                          setDropdownOpen(false);
                        }}
                        className="block w-full px-2 py-1 hover:bg-gray-700 rounded mb-1"
                      >
                        Provider Wallet
                      </button>
                    </>
                  )}

                  {!isProvider && (
                    <>
                      <button
                        onClick={() => {
                          router.push('/bookings');
                          setDropdownOpen(false);
                        }}
                        className="block w-full px-2 py-1 hover:bg-gray-700 rounded mb-1"
                      >
                        My Bookings
                      </button>
                      <button
                        onClick={() => {
                          router.push('/wallet');
                          setDropdownOpen(false);
                        }}
                        className="block w-full px-2 py-1 hover:bg-gray-700 rounded mb-1"
                      >
                        My Wallet
                      </button>
                    </>
                  )}

                  <button
                    onClick={() => {
                      router.push('/profile');
                      setDropdownOpen(false);
                    }}
                    className="block w-full px-2 py-1 hover:bg-gray-700 rounded mb-1"
                  >
                    Edit Profile
                  </button>

                  <button
                    onClick={handleSignOut}
                    className="block w-full px-2 py-1 hover:bg-gray-700 rounded text-red-400"
                  >
                    Sign Out
                  </button>
                </>
              ) : (
                <button
                  onClick={openAuthModal}
                  className="block w-full px-2 py-1 hover:bg-gray-700 rounded"
                >
                  Sign In / Sign Up
                </button>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Clear search/filters pill (top-left) */}
      {anyFilterActive && (
        <div className="absolute top-3 left-3 z-50">
          <button
            type="button"
            onClick={handleClearSearchAndFilters}
            className="px-3 py-1.5 rounded-full bg-white/10 border border-white/30 text-xs text-white hover:bg-white/20 flex items-center gap-2"
          >
            <span>Clear search / filters</span>
            <FaTimes className="text-[10px]" />
          </button>
        </div>
      )}

      {/* Filters dropdown (anchored, not full-screen) */}
      <ServiceFiltersDropdown
        open={filtersOpen}
        value={filters}
        onChange={setFilters}
        onClose={() => setFiltersOpen(false)}
        onClear={handleClearFilters}
      />

      {/* 🔔 Notifications modal */}
      {notificationsOpen && (
        <div className="fixed inset-0 z-[9998] bg-black/70 flex items-center justify-center">
          <div className="bg-neutral-900 text-white rounded-xl shadow-xl w-[90vw] max-w-md max-h-[85vh] flex flex-col overflow-hidden">
            {/* header */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-white/10">
              <div className="flex items-center gap-2">
                <FaBell className="text-sm" />
                <h2 className="text-sm font-semibold">Notifications</h2>
                {unreadCount > 0 && (
                  <span className="ml-1 inline-flex items-center justify-center min-w-[18px] h-4 px-1 rounded-full bg-green-500 text-[10px] font-semibold">
                    {unreadCount > 9 ? '9+' : unreadCount}
                  </span>
                )}
              </div>
              <button
                type="button"
                onClick={() => setNotificationsOpen(false)}
                className="text-xs text-gray-300 hover:text-white"
                aria-label="Close notifications"
              >
                <FaTimes />
              </button>
            </div>

            {/* list */}
            <div className="flex-1 overflow-y-auto px-4 py-3 space-y-2">
              {notifications.length === 0 && (
                <div className="text-xs text-gray-400 text-center py-6">
                  You don't have any notifications yet.
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
                    className={`rounded-lg border border-white/10 px-3 py-2 text-xs sm:text-sm cursor-pointer transition ${
                      isUnread ? 'bg-white/10' : 'bg-transparent'
                    }`}
                    onClick={() => handleOpenBookingFromNotification(n)}
                  >
                    <div className="flex items-center justify-between gap-2">
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
                    <div className="mt-2 flex items-center justify-between">
                      {time && (
                        <span className="text-[10px] text-gray-500">
                          {time}
                        </span>
                      )}
                      {n.bookingId && (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleOpenBookingFromNotification(n);
                          }}
                          className="text-[11px] px-2 py-0.5 rounded-full bg-emerald-500/20 border border-emerald-400/50 text-emerald-200 hover:bg-emerald-500/30"
                        >
                          View booking
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>

            {/* footer */}
            <div className="border-t border-white/10 px-4 py-3 flex justify-between gap-2">
              <button
                type="button"
                onClick={() => {
                  router.push('/notifications');
                  setNotificationsOpen(false);
                }}
                className="flex-1 text-xs sm:text-sm px-3 py-2 rounded-full bg-white text-black font-semibold hover:bg-gray-200"
              >
                See all notifications
              </button>
              <button
                type="button"
                onClick={() => setNotificationsOpen(false)}
                className="flex-1 text-xs sm:text-sm px-3 py-2 rounded-full bg-neutral-800 text-white hover:bg-neutral-700"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Scroll-snap container */}
      <div
        ref={sliderRef}
        className="h-screen overflow-y-scroll snap-y snap-mandatory scroll-smooth [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]"
      >
        {filteredVideos.map((v, i) => {
          const up = userProfiles[v.userId || ''] || {};
          const liked = likesMap[v.id];
          const followed = up && user ? followMap[v.userId!] : false;
          const isOwner = v.userId === user?.uid;

          const displayedPrice =
            typeof v.serviceCost === 'number'
              ? applyMarkup(v.serviceCost, markupConfig)
              : null;

          const media = getMediaList(v);
          const hasCarousel = media.length > 1;
          const activeIdx = mediaIndexMap[v.id] ?? 0;
          const active = media[activeIdx] || media[0];

          // Handles for this creator
          const personalHandle = normalizeHandle(
            up.personalUsername || up.username,
          );
          const businessHandle = normalizeHandle(
            up.businessUsername || personalHandle,
          );

          // Pretty URL: /{businessHandle} for businesses, /u/{handle} for personal-only
          const creatorUrl = businessHandle
            ? `/${businessHandle}`
            : personalHandle
            ? `/u/${personalHandle}`
            : v.userId
            ? `/creator/${v.userId}`
            : '/';

          return (
            <div
              key={`${v.id}-${i}`}
              className="relative h-screen flex items-center justify-center snap-start"
            >
              {/* Stack badge */}
              {hasCarousel && (
                <div className="absolute top-3 right-3 z-50">
                  <div className="bg-black/70 text-white rounded-full p-2 flex items-center justify-center">
                    <FaImages className="text-sm" />
                  </div>
                </div>
              )}

              {/* Media viewer with swipe handlers */}
              <div
                className="relative max-h-screen max-w-full z-40"
                onTouchStart={(e) => {
                  const t = e.touches[0];
                  touchStartXRef.current[v.id] = t.clientX;
                  touchStartYRef.current[v.id] = t.clientY;
                }}
                onTouchEnd={(e) => {
                  const startX = touchStartXRef.current[v.id];
                  const startY = touchStartYRef.current[v.id];
                  const t = e.changedTouches[0];
                  const dx = t.clientX - (startX ?? t.clientX);
                  const dy = t.clientY - (startY ?? t.clientY);
                  const THRESH_X = 40;
                  if (
                    Math.abs(dx) > THRESH_X &&
                    Math.abs(dx) > Math.abs(dy)
                  ) {
                    if (dx < 0) {
                      setMediaIndex(v.id, (activeIdx + 1) % media.length);
                    } else {
                      setMediaIndex(
                        v.id,
                        (activeIdx - 1 + media.length) % media.length,
                      );
                    }
                    e.preventDefault();
                    e.stopPropagation();
                  }
                  delete touchStartXRef.current[v.id];
                  delete touchStartYRef.current[v.id];
                }}
              >
                {active?.type === 'image' ||
                (active && isImageUrl(active.url)) ? (
                  <img
                    src={active.url}
                    alt={v.title || 'service image'}
                    className="max-h-screen max-w-full object-contain select-none"
                    draggable={false}
                  />
                ) : (
                  <video
                    key={active?.url}
                    src={active?.url}
                    muted
                    loop
                    playsInline
                    onClick={togglePlay}
                    className="max-h-screen max-w-full object-contain"
                  />
                )}
              </div>

              {/* Carousel arrows */}
              {hasCarousel && (
                <>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setMediaIndex(
                        v.id,
                        (activeIdx - 1 + media.length) % media.length,
                      );
                    }}
                    className="absolute left-3 top-1/2 -translate-y-1/2 z-50 bg-white/70 hover:bg-white text-black rounded-full p-2"
                    aria-label="Previous"
                  >
                    <FaChevronLeft />
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setMediaIndex(v.id, (activeIdx + 1) % media.length);
                    }}
                    className="absolute right-3 top-1/2 -translate-y-1/2 z-50 bg-white/70 hover:bg-white text-black rounded-full p-2"
                    aria-label="Next"
                  >
                    <FaChevronRight />
                  </button>

                  {/* Dots indicator */}
                  <div className="absolute bottom-3 left-1/2 -translate-x-1/2 z-50 flex space-x-1">
                    {media.map((_, idx) => (
                      <span
                        key={idx}
                        className={`h-2 w-2 rounded-full ${
                          idx === activeIdx ? 'bg-white' : 'bg-white/40'
                        }`}
                      />
                    ))}
                  </div>
                </>
              )}

              {/* Creator pill */}
              <div
                onClick={() => router.push(creatorUrl)}
                className="absolute top-3 left-3 bg-black/70 px-1 py-0.5 rounded-md cursor-pointer hover:bg-black/90 transition text-xs font-semibold text-white z-50"
              >
                {up.businessName
                  ? up.businessName
                  : businessHandle
                  ? `@${businessHandle}`
                  : personalHandle
                  ? `@${personalHandle}`
                  : '@unknown'}
              </div>

              {/* Actions */}
              <div className="absolute bottom-3 right-3 flex flex-col items-center space-y-2 z-50">
                <button onClick={() => handleLike(v.id)} className="text-xl">
                  {liked ? (
                    <FaHeart className="text-red-500" />
                  ) : (
                    <FaRegHeart />
                  )}
                </button>
                <button
                  className="text-xl"
                  onClick={() => setCommentVideo(v.id)}
                >
                  <FaCommentDots />
                </button>
                <button
                  className="text-xl"
                  onClick={() => handleShare(v)}
                >
                  <FaShare />
                </button>
                {v.userId !== user?.uid && (
                  <button
                    onClick={() => handleFollow(v.userId!)}
                    className="text-xl"
                  >
                    {followed ? <FaUserCheck /> : <FaUserPlus />}
                  </button>
                )}
                <button
                  onClick={() => setBookingVideo(v)}
                  className="bg-green-500 hover:bg-green-600 text-white px-2 py-1 rounded text-xs"
                >
                  Book Service
                </button>
              </div>

              {/* Owner controls */}
              {isOwner && (
                <div className="absolute top-16 right-3 flex flex-col space-y-1 z-50">
                  <button
                    onClick={() => setEditingVideo(v)}
                    className="bg-yellow-500 hover:bg-yellow-600 text-white text-xs px-2 py-1 rounded"
                  >
                    Edit
                  </button>
                  <button
                    onClick={() => handleDelete(v.id)}
                    className="bg-red-500 hover:bg-red-600 text-white text-xs px-2 py-1 rounded"
                  >
                    Delete
                  </button>
                </div>
              )}

              {/* Text + Price */}
              {(v.title || v.description || displayedPrice !== null) && (
                <div className="absolute bottom-3 left-3 max-w-[60%] overflow-hidden text-ellipsis z-50">
                  {v.title && (
                    <h3 className="text-sm font-bold text-white">{v.title}</h3>
                  )}
                  {v.description && (
                    <p className="text-xs text-gray-200">{v.description}</p>
                  )}
                  {displayedPrice !== null && (
                    <div className="mt-2">
                      <span className="inline-block bg-white/90 text-black text-xs font-bold px-2 py-1 rounded">
                        KSHS {displayedPrice.toLocaleString()}
                      </span>
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {isSliderReady && sliderInstanceRef.current && (
        <div className="absolute right-3 top-1/2 transform -translate-y-1/2 hidden sm:flex flex-col space-y-2 z-50">
          <button
            onClick={scrollPrev}
            className="bg-white/20 hover:bg-white/40 p-1 rounded-full text-white"
          >
            <FaChevronUp />
          </button>
          <button
            onClick={scrollNext}
            className="bg-white/20 hover:bg-white/40 p-1 rounded-full text-white"
          >
            <FaChevronDown />
          </button>
        </div>
      )}

      {authDialogOpen && (
        <AuthModal
          open={authDialogOpen}
          onClose={() => setAuthDialogOpen(false)}
        />
      )}
      {commentVideo && (
        <CommentModal
          videoId={commentVideo}
          onClose={() => setCommentVideo(null)}
        />
      )}
      {bookingVideo && (
        <BookingModal
          video={bookingVideo}
          creator={userProfiles[bookingVideo.userId!] ?? {}}
          onClose={() => setBookingVideo(null)}
        />
      )}
      {editingVideo && (
        <EditVideoModal
          video={editingVideo}
          onClose={() => setEditingVideo(null)}
        />
      )}

      {/* NEW: Post share modal */}
      {shareVideo && (
        <PostShareModal
          video={shareVideo}
          creatorProfile={userProfiles[shareVideo.userId!] ?? null}
          onClose={() => setShareVideo(null)}
        />
      )}
    </div>
  );
}

/* -------------------------------------------------------
 * Post Share Modal – YouTube-style with more networks
 * Shares a specific video/image + link + curated message
 * ----------------------------------------------------- */

function PostShareModal({
  video,
  creatorProfile,
  onClose,
}: {
  video: VideoDoc;
  creatorProfile: UserProfile | null;
  onClose: () => void;
}) {
  const url =
    typeof window !== 'undefined'
      ? `${window.location.origin}/video/${video.id}`
      : '';

  const creatorName =
    creatorProfile?.businessName ||
    creatorProfile?.username ||
    creatorProfile?.personalUsername ||
    creatorProfile?.businessUsername ||
    'this provider';

  const shareText = `Book this service on VextUp from ${creatorName} – see details, pricing and reserve a slot instantly here: ${url}`;

  const copyTextAndNotify = async (message?: string) => {
    try {
      await navigator.clipboard.writeText(message ?? shareText);
      alert('Share text copied to clipboard!');
    } catch (err) {
      console.error('copy failed', err);
      alert('Could not copy text.');
    }
  };

  const copyLinkOnly = async () => {
    try {
      await navigator.clipboard.writeText(url);
      alert('Post link copied to clipboard!');
    } catch (err) {
      console.error('copy failed', err);
      alert('Could not copy link.');
    }
  };

  const openWindow = (shareUrl: string) => {
    window.open(shareUrl, '_blank', 'noopener,noreferrer');
  };

  const handleWhatsapp = () => {
    openWindow(`https://wa.me/?text=${encodeURIComponent(shareText)}`);
  };

  const handleFacebook = () => {
    openWindow(
      `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(
        url,
      )}&quote=${encodeURIComponent(shareText)}`,
    );
  };

  const handleTwitter = () => {
    openWindow(
      `https://twitter.com/intent/tweet?text=${encodeURIComponent(
        shareText,
      )}`,
    );
  };

  const handleEmail = () => {
    window.location.href = `mailto:?subject=${encodeURIComponent(
      'Check out this VextUp service',
    )}&body=${encodeURIComponent(shareText)}`;
  };

  // Instagram & TikTok: copy caption + open app/site so user can paste
  const handleInstagram = async () => {
    await copyTextAndNotify();
    openWindow('https://www.instagram.com/');
  };

  const handleTiktok = async () => {
    await copyTextAndNotify();
    openWindow('https://www.tiktok.com/');
  };

  // Simple preview: first media item
  const preview: MediaItem | null = (() => {
    if (video.media && video.media.length > 0) return video.media[0];
    if (video.url) {
      const base = video.url.split('?')[0].toLowerCase();
      const isImg =
        /\.(png|jpe?g|gif|webp|avif|bmp)$/.test(base) ||
        base.startsWith('data:image');
      return { url: video.url, type: isImg ? 'image' : 'video' };
    }
    return null;
  })();

  return (
    <div className="fixed inset-0 z-[9999] bg-black/70 flex items-center justify-center">
      <div className="bg-white rounded-lg shadow-xl w-[95vw] max-w-md p-5">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold text-gray-900">
            Share this service
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="text-xs text-gray-500 hover:text-gray-800"
          >
            <FaTimes />
          </button>
        </div>

        {/* Post preview */}
        <div className="flex items-center gap-3 mb-4">
          <div className="w-16 h-16 rounded-md overflow-hidden bg-gray-100 flex items-center justify-center">
            {preview ? (
              preview.type === 'image' ? (
                <img
                  src={preview.url}
                  alt={video.title || 'service preview'}
                  className="w-full h-full object-cover"
                />
              ) : (
                <video
                  src={preview.url}
                  className="w-full h-full object-cover"
                  muted
                  playsInline
                />
              )
            ) : (
              <span className="text-[10px] text-gray-400 px-2 text-center">
                Preview unavailable
              </span>
            )}
          </div>
          <div className="flex-1 min-w-0">
            {video.title && (
              <p className="text-xs font-semibold text-gray-900 truncate">
                {video.title}
              </p>
            )}
            {video.description && (
              <p className="text-[11px] text-gray-500 line-clamp-2">
                {video.description}
              </p>
            )}
            <p className="text-[11px] text-gray-600 mt-1">
              From <span className="font-medium">{creatorName}</span> on
              VextUp.
            </p>
          </div>
        </div>

        <div className="space-y-4 text-sm text-gray-900">
          <div>
            <p className="text-xs text-gray-600 mb-2">Share</p>
            <div className="flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={handleWhatsapp}
                className="flex flex-col items-center text-xs text-gray-700 hover:text-black"
              >
                <div className="w-9 h-9 rounded-full border flex items-center justify-center mb-1">
                  <FaWhatsapp />
                </div>
                WhatsApp
              </button>

              <button
                type="button"
                onClick={handleFacebook}
                className="flex flex-col items-center text-xs text-gray-700 hover:text-black"
              >
                <div className="w-9 h-9 rounded-full border flex items-center justify-center mb-1">
                  <FaFacebook />
                </div>
                Facebook
              </button>

              <button
                type="button"
                onClick={handleTwitter}
                className="flex flex-col items-center text-xs text-gray-700 hover:text-black"
              >
                <div className="w-9 h-9 rounded-full border flex items-center justify-center mb-1">
                  <FaTwitter />
                </div>
                X/Twitter
              </button>

              <button
                type="button"
                onClick={handleEmail}
                className="flex flex-col items-center text-xs text-gray-700 hover:text-black"
              >
                <div className="w-9 h-9 rounded-full border flex items-center justify-center mb-1">
                  <FaEnvelope />
                </div>
                Email
              </button>

              <button
                type="button"
                onClick={handleInstagram}
                className="flex flex-col items-center text-xs text-gray-700 hover:text-black"
              >
                <div className="w-9 h-9 rounded-full border flex items-center justify-center mb-1">
                  <FaInstagram />
                </div>
                Instagram
              </button>

              <button
                type="button"
                onClick={handleTiktok}
                className="flex flex-col items-center text-xs text-gray-700 hover:text-black"
              >
                <div className="w-9 h-9 rounded-full border flex items-center justify-center mb-1">
                  <SiTiktok />
                </div>
                TikTok
              </button>
            </div>
          </div>

          <div>
            <p className="text-xs text-gray-600 mb-1">
              Message + link to share
            </p>
            <textarea
              readOnly
              value={shareText}
              className="w-full border rounded px-2 py-2 text-xs bg-gray-50 h-20 resize-none text-gray-800"
            />
            <div className="mt-2 flex gap-2 flex-wrap">
              <button
                type="button"
                onClick={() => copyTextAndNotify()}
                className="px-3 py-1 rounded-full bg-gray-900 text-white text-xs font-medium hover:bg-black"
              >
                Copy message + link
              </button>
              <button
                type="button"
                onClick={copyLinkOnly}
                className="px-3 py-1 rounded-full border border-gray-300 text-xs font-medium hover:bg-gray-100 text-gray-700"
              >
                Copy link only
              </button>
            </div>
          </div>

          <p className="text-[11px] text-gray-500">
            For WhatsApp, Facebook and X, the thumbnail comes from the VextUp
            post page when you share this link. On Instagram and TikTok, we
            copy the message to your clipboard and open their site/app so you
            can paste it into a post, story or DM.
          </p>
        </div>
      </div>
    </div>
  );
}