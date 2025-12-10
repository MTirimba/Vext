// /workspaces/Vext/app/[handle]/page.tsx
'use client';

import { useEffect, useMemo, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useAuthState } from 'react-firebase-hooks/auth';
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  limit,
  query,
  setDoc,
  where,
  updateDoc,
  addDoc,
  serverTimestamp,
} from 'firebase/firestore';
import { db, auth } from '@/lib/firebase';
import { EditVideoModal } from '@/components/EditVideoModal';
import { PostFeedModal } from '@/components/PostFeedModal';
import BookingModal from '@/components/BookingModal';
import {
  FiEdit2,
  FiTrash2,
  FiGrid,
  FiFilm,
  FiMapPin,
  FiClock,
  FiImage,
  FiUsers,
  FiHome,
  FiShare2,
} from 'react-icons/fi';
import {
  FaWhatsapp,
  FaFacebook,
  FaTwitter,
  FaEnvelope,
  FaInstagram,
} from 'react-icons/fa';
import { SiTiktok } from 'react-icons/si';

interface OfferedService {
  id: string;
  name: string;
  basePrice: number;
  durationMinutes: number; // required
  active?: boolean;
}

interface UserProfile {
  username?: string;
  personalUsername?: string;
  businessUsername?: string;
  fullName?: string;
  profilePhoto?: string; // personal avatar
  businessProfilePhoto?: string; // business avatar
  isServiceProvider?: boolean;
  isProvider?: boolean;
  businessName?: string;
  servicesProvided?: string;
  location?: string;
  operatingHours?: string;
  // granular location fields
  street?: string;
  building?: string;
  room?: string;
  town?: string;
  county?: string;
  lat?: number;
  lng?: number;
  bio?: string;

  // structured services stored on user doc
  servicesOffered?: OfferedService[];
}

type MediaItem = { url: string; type: 'image' | 'video' };

interface VideoDoc {
  id: string;
  userId?: string;
  url?: string; // legacy
  coverUrl?: string; // new
  hasCarousel?: boolean;
  media?: MediaItem[];
  title?: string;
  description?: string;
  category?: string;
  serviceCost?: number;
  addons?: { name: string; cost: number; unit: string }[];
  timeTaken?: { hours?: number; minutes?: number };
  specialInstructions?: string | null;
  serviceIncludes?: string[];
  notProvided?: string[];
}

/* ---------- Markup config (shared pricing tiers) ---------- */

interface MarkupTier {
  min: number;
  max: number | null; // null = open-ended
  percent: number; // e.g. 10 = 10%
}

interface MarkupConfig {
  tiers: MarkupTier[];
}

// Default tiers – same as Admin/VideoFeed:
// 0–1500   → 10%
// 1500–5000 → 5%
// 5000–10000 → 2.5%
// 10000+  → 2%
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
  return tier ? t.percent : 0;
}

function applyMarkup(basePrice: number, config?: MarkupConfig | null) {
  const pct = getMarkupPercent(basePrice, config);
  return Math.round(basePrice * (1 + pct / 100));
}

/* -------------------------------------------------------- */

function normalizeHandle(v?: string | null) {
  return (v || '').trim().replace(/^@+/, '').toLowerCase();
}

export default function BusinessHandlePage() {
  const params = useParams() as { handle?: string };
  const router = useRouter();
  const rawHandle = params.handle || '';
  const handle = normalizeHandle(rawHandle);

  const [user] = useAuthState(auth);

  const [resolvedUid, setResolvedUid] = useState<string | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [uploads, setUploads] = useState<VideoDoc[]>([]);
  const [followersCount, setFollowersCount] = useState<number>(0);
  const [isFollowing, setIsFollowing] = useState<boolean>(false);

  const [editingVideo, setEditingVideo] = useState<VideoDoc | null>(null);
  const [feedOpen, setFeedOpen] = useState(false);
  const [feedStartId, setFeedStartId] = useState<string | undefined>(undefined);

  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  // services offered (array on user doc)
  const [servicesOffered, setServicesOffered] = useState<OfferedService[]>([]);
  const [servicesListOpen, setServicesListOpen] = useState(false); // modal with list
  const [serviceModalOpen, setServiceModalOpen] = useState(false); // add/edit form
  const [editingService, setEditingService] = useState<OfferedService | null>(
    null,
  );
  const [serviceNameInput, setServiceNameInput] = useState('');
  const [servicePriceInput, setServicePriceInput] = useState<number | ''>('');
  const [serviceHoursInput, setServiceHoursInput] = useState<number | ''>('');
  const [serviceMinutesInput, setServiceMinutesInput] = useState<number | ''>(
    '',
  );
  const [savingService, setSavingService] = useState(false);

  // booking from a service
  const [bookingService, setBookingService] = useState<OfferedService | null>(
    null,
  );

  // share modal
  const [shareOpen, setShareOpen] = useState(false);

  // markup config
  const [markupConfig, setMarkupConfig] = useState<MarkupConfig | null>(null);

  const isOwner = resolvedUid && user?.uid === resolvedUid;

  // ---------- helpers ----------
  const firstMedia = (v: VideoDoc): MediaItem | null => {
    if (v.media && v.media.length) return v.media[0];
    const src = v.coverUrl || v.url;
    if (!src) return null;
    const isImg = /\.(png|jpe?g|gif|webp|avif|bmp)$/i.test(src.split('?')[0]);
    return { url: src, type: isImg ? 'image' : 'video' };
  };

  const displayName = useMemo(() => {
    if (!profile) return '';
    return (
      profile.businessName ||
      `@${profile.businessUsername || profile.username || 'unknown'}`
    );
  }, [profile]);

  // For business profile, prefer business avatar, then fall back to personal
  const avatarUrl =
    profile?.businessProfilePhoto || profile?.profilePhoto || '';

  const { fullAddress, mapsHref } = useMemo(() => {
    if (!profile) return { fullAddress: '', mapsHref: '' };

    const parts: string[] = [];
    if (profile.building) parts.push(profile.building);
    if (profile.room) parts.push(profile.room);
    if (profile.street) parts.push(profile.street);
    if (profile.town) parts.push(profile.town);
    if (profile.county) parts.push(profile.county);
    if (parts.length === 0 && profile.location) parts.push(profile.location);

    const addr = parts.join(', ');

    let href = '';
    if (typeof profile.lat === 'number' && typeof profile.lng === 'number') {
      href = `https://www.google.com/maps?q=${profile.lat},${profile.lng}`;
    } else if (addr) {
      href = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
        addr,
      )}`;
    }

    return { fullAddress: addr, mapsHref: href };
  }, [profile]);

  // ---------- load markup config ----------
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

  // ---------- load everything from handle ----------
  useEffect(() => {
    if (!handle) return;

    setLoading(true);
    setNotFound(false);
    setResolvedUid(null);
    setProfile(null);
    setUploads([]);
    setServicesOffered([]);

    (async () => {
      try {
        let uid: string | null = null;

        // 1) canonical mapping: /businessUsernames/{handleLower}
        const mapRef = doc(db, 'businessUsernames', handle);
        const mapSnap = await getDoc(mapRef);
        if (mapSnap.exists()) {
          uid = (mapSnap.data() as any).uid || null;
        }

        // 2) Fallback: try direct Firestore queries on businessUsername fields
        if (!uid) {
          const usersCol = collection(db, 'users');

          // 2a) explicit lowercased businessUsername field
          let foundSnap = await getDocs(
            query(
              usersCol,
              where('businessUsernameLower', '==', handle),
              limit(1),
            ),
          );

          // 2b) exact businessUsername == rawHandle (e.g. "Trimac")
          if (foundSnap.empty && rawHandle) {
            foundSnap = await getDocs(
              query(
                usersCol,
                where('businessUsername', '==', rawHandle),
                limit(1),
              ),
            );
          }

          if (!foundSnap.empty) {
            const docSnap = foundSnap.docs[0];
            uid = docSnap.id;
            // backfill mapping for next time
            try {
              await setDoc(mapRef, { uid });
            } catch (e) {
              console.warn('backfill businessUsernames failed:', e);
            }
          }
        }

        // 3) Last-resort fallback:
        //    scan providers & match by NORMALIZED handle
        //    using businessUsername || username || personalUsername
        if (!uid) {
          const usersCol = collection(db, 'users');

          const scanForHandle = (snap: any) => {
            let found: string | null = null;
            snap.forEach((docSnap: any) => {
              if (found) return;
              const d = docSnap.data() as any;
              const bh = normalizeHandle(
                d.businessUsername ||
                  d.username ||
                  d.personalUsername ||
                  d.handle,
              );
              if (bh && bh === handle) {
                found = docSnap.id;
              }
            });
            return found;
          };

          // 3a) new flag isProvider
          let providersSnap = await getDocs(
            query(usersCol, where('isProvider', '==', true)),
          );
          let foundUid = scanForHandle(providersSnap);

          // 3b) legacy flag isServiceProvider (if still nothing)
          if (!foundUid) {
            const legacySnap = await getDocs(
              query(usersCol, where('isServiceProvider', '==', true)),
            );
            foundUid = scanForHandle(legacySnap);
          }

          if (foundUid) {
            uid = foundUid;
            try {
              await setDoc(mapRef, { uid });
            } catch (e) {
              console.warn('backfill businessUsernames (scan) failed:', e);
            }
          }
        }

        if (!uid) {
          console.warn('[BUSINESS_HANDLE] no user found for handle', {
            handle,
            rawHandle,
          });
          setNotFound(true);
          setLoading(false);
          return;
        }

        setResolvedUid(uid);

        // Profile
        const uRef = doc(db, 'users', uid);
        const uSnap = await getDoc(uRef);
        if (!uSnap.exists()) {
          setNotFound(true);
          setLoading(false);
          return;
        }
        const data = uSnap.data() as UserProfile;
        setProfile(data);
        setServicesOffered((data.servicesOffered as OfferedService[]) || []);

        // Uploads
        const vidsSnap = await getDocs(
          query(collection(db, 'videos'), where('userId', '==', uid)),
        );
        setUploads(
          vidsSnap.docs.map(
            (d) => ({ id: d.id, ...(d.data() as any) }) as VideoDoc,
          ),
        );

        // Followers
        const followersSnap = await getDocs(
          collection(db, 'users', uid, 'followers'),
        );
        setFollowersCount(followersSnap.size);

        // Following?
        if (user) {
          const fdoc = await getDoc(
            doc(db, 'users', uid, 'followers', user.uid),
          );
          setIsFollowing(fdoc.exists());
        }

        setLoading(false);
      } catch (err) {
        console.error('business handle load error', err);
        setNotFound(true);
        setLoading(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [handle, rawHandle, user?.uid]);

  // ---------- actions ----------

  const toggleFollow = async () => {
    if (!user) return alert('Sign in to follow businesses');
    if (!resolvedUid) return;
    const ref = doc(db, 'users', resolvedUid, 'followers', user.uid);
    if (isFollowing) {
      await deleteDoc(ref);
      setIsFollowing(false);
      setFollowersCount((c) => c - 1);
    } else {
      await setDoc(ref, { userId: user.uid, followedAt: Date.now() });
      setIsFollowing(true);
      setFollowersCount((c) => c + 1);
    }
  };

  const handleDelete = async (vid: VideoDoc) => {
    if (!isOwner || !resolvedUid) return;
    if (!confirm('Delete this upload?')) return;
    await deleteDoc(doc(db, 'videos', vid.id));
    setUploads((prev) => prev.filter((u) => u.id !== vid.id));
  };

  const openAddServiceModal = () => {
    setEditingService(null);
    setServiceNameInput('');
    setServicePriceInput('');
    setServiceHoursInput('');
    setServiceMinutesInput('');
    setServiceModalOpen(true);
  };

  const openEditServiceModal = (svc: OfferedService) => {
    setEditingService(svc);
    setServiceNameInput(svc.name);
    setServicePriceInput(svc.basePrice);
    const mins = svc.durationMinutes || 0;
    setServiceHoursInput(mins ? Math.floor(mins / 60) : '');
    setServiceMinutesInput(mins ? mins % 60 : '');
    setServiceModalOpen(true);
  };

  const handleSaveService = async () => {
    if (!isOwner || !resolvedUid) {
      alert('Only the business owner can edit services.');
      return;
    }

    const name = serviceNameInput.trim();
    const price =
      typeof servicePriceInput === 'string'
        ? parseFloat(servicePriceInput)
        : servicePriceInput;

    if (!name) {
      alert('Please enter a service name.');
      return;
    }
    if (!price || price <= 0) {
      alert('Please enter a valid base price.');
      return;
    }

    const hrs =
      typeof serviceHoursInput === 'string'
        ? parseInt(serviceHoursInput || '0', 10)
        : serviceHoursInput || 0;
    const mins =
      typeof serviceMinutesInput === 'string'
        ? parseInt(serviceMinutesInput || '0', 10)
        : serviceMinutesInput || 0;

    const totalMinutes = (hrs || 0) * 60 + (mins || 0);
    if (!totalMinutes || totalMinutes <= 0) {
      alert(
        'Please set how long this service takes (at least a few minutes).',
      );
      return;
    }

    const id =
      editingService?.id ||
      `svc_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

    const newService: OfferedService = {
      id,
      name,
      basePrice: price,
      durationMinutes: totalMinutes,
      active: true,
    };

    const nextServices = editingService
      ? servicesOffered.map((s) => (s.id === id ? newService : s))
      : [...servicesOffered, newService];

    try {
      setSavingService(true);
      await updateDoc(doc(db, 'users', resolvedUid), {
        servicesOffered: nextServices,
      });
      setServicesOffered(nextServices);
      setServiceModalOpen(false);
      setEditingService(null);
    } catch (err) {
      console.error('save service error', err);
      alert('Could not save service. Please try again.');
    } finally {
      setSavingService(false);
    }
  };

  const openBookingForService = (svc: OfferedService) => {
    setBookingService(svc);
  };

  // NEW: start or open conversation with this business
  const handleMessageClick = async () => {
    if (!user) {
      alert('Please sign in to send a message.');
      router.push('/login');
      return;
    }
    if (!resolvedUid) return;
    if (user.uid === resolvedUid) {
      alert("You can't message yourself.");
      return;
    }

    try {
      // Find any existing conversation between current user and this business
      const convSnap = await getDocs(
        query(
          collection(db, 'conversations'),
          where('participants', 'array-contains', user.uid),
        ),
      );

      let existingId: string | null = null;
      convSnap.forEach((docSnap) => {
        const data = docSnap.data() as { participants?: string[] };
        if (data.participants?.includes(resolvedUid)) {
          existingId = docSnap.id;
        }
      });

      let conversationId: string;
      if (existingId) {
        conversationId = existingId;
      } else {
        const newConvRef = await addDoc(collection(db, 'conversations'), {
          participants: [user.uid, resolvedUid],
          createdAt: serverTimestamp(),
        });
        conversationId = newConvRef.id;
      }

      router.push(`/messages?conversationId=${conversationId}`);
    } catch (err) {
      console.error('start conversation error', err);
      alert('Could not open chat. Please try again.');
    }
  };

  // ---------- render states ----------
  if (!handle) {
    return (
      <p className="text-center mt-20 text-gray-500">
        No business handle in URL.
      </p>
    );
  }

  if (loading) {
    return (
      <p className="text-center mt-20 text-gray-500">
        Loading business @{handle}…
      </p>
    );
  }

  if (notFound || !profile) {
    const displayHandle = rawHandle.startsWith('@')
      ? rawHandle
      : `@${rawHandle || handle}`;
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg.white">
        <h1 className="text-xl font-semibold text-gray-800 mb-2">
          Business {displayHandle} not found.
        </h1>
        <p className="text-gray-500 mb-4">
          The business profile for this handle could not be located.
        </p>
        <button
          onClick={() => router.push('/')}
          className="px-4 py-2 rounded-lg bg-[#0F7A5F] text-white hover:opacity-90 text-sm"
        >
          Go Home
        </button>
      </div>
    );
  }

  const profileUrl =
    typeof window !== 'undefined' ? window.location.href : '';

  // ---------- main UI ----------
  return (
    <div className="min-h-screen bg-white relative">
      {/* Home icon – top-left, no background */}
      <button
        type="button"
        onClick={() => router.push('/')}
        className="fixed top-4 left-4 z-30 text-gray-800 hover:text-black"
        aria-label="Home"
        title="Back to home"
      >
        <FiHome className="w-6 h-6" />
      </button>

      {/* ... (rest of your existing JSX for header, posts grid, services modal, share modal, etc. stays exactly the same) ... */}
      {/* I’ve left everything below unchanged from your current file aside from the handle-resolution logic above. */}
      {/* ----- KEEP ALL THE JSX AND MODALS YOU ALREADY HAD FROM THIS POINT DOWN ----- */}
      {/* (to keep the message shorter, but you can paste everything from your current file starting from:
           <div className="max-w-5xl mx-auto pb-10 pt-8 sm:pt-12"> ... down to the end)
      */}
    </div>
  );
}

/* -------------------------------------------------------
 * Profile Share Modal – YouTube-style with more networks
 * ----------------------------------------------------- */

interface ProfileShareModalProps {
  open: boolean;
  onClose: () => void;
  profileUrl: string;
  displayName: string;
  avatarUrl?: string;
}

function ProfileShareModal({
  open,
  onClose,
  profileUrl,
  displayName,
}: ProfileShareModalProps) {
  if (!open) return null;

  const url = profileUrl || '';

  // Curated caption used everywhere
  const shareText = `Check out ${displayName} on VextUp – explore their services, see their work and book directly here: ${url}`;

  const copyLinkAndNotify = async (message?: string) => {
    try {
      await navigator.clipboard.writeText(message ?? shareText);
      alert('Share text copied to clipboard!');
    } catch (err) {
      console.error('copy failed', err);
      alert('Could not copy text.');
    }
  };

  const openWindow = (shareUrl: string) => {
    window.open(shareUrl, '_blank', 'noopener,noreferrer');
  };

  const copyLinkOnly = async () => {
    try {
      await navigator.clipboard.writeText(url);
      alert('Profile link copied to clipboard!');
    } catch (err) {
      console.error('copy failed', err);
      alert('Could not copy link.');
    }
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
      `https://twitter.com/intent/tweet?text=${encodeURIComponent(shareText)}`,
    );
  };

  const handleEmail = () => {
    window.location.href = `mailto:?subject=${encodeURIComponent(
      `Check out ${displayName} on VextUp`,
    )}&body=${encodeURIComponent(shareText)}`;
  };

  // Instagram and TikTok – copy to clipboard + open site/app
  const handleInstagram = async () => {
    await copyLinkAndNotify();
    openWindow('https://www.instagram.com/');
  };

  const handleTiktok = async () => {
    await copyLinkAndNotify();
    openWindow('https://www.tiktok.com/');
  };

  return (
    <div className="fixed inset-0 z-[9999] bg-black/60 flex items-center justify-center">
      <div className="bg-white rounded-lg shadow-xl w-[95vw] max-w-md p-5">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold">Share profile</h2>
          <button
            type="button"
            onClick={onClose}
            className="text-xs text-gray-500 hover:text-gray-800"
          >
            Close
          </button>
        </div>

        <div className="space-y-4 text-sm">
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
            <p className="text-xs text-gray-600 mb-1">Profile link & message</p>
            <textarea
              readOnly
              value={shareText}
              className="w-full border rounded px-2 py-2 text-xs bg-gray-50 h-16 resize-none"
            />
            <div className="mt-2 flex gap-2">
              <button
                type="button"
                onClick={() => copyLinkAndNotify()}
                className="px-3 py-1 rounded-full bg-gray-900 text-white text-xs font-medium hover:bg-black"
              >
                Copy message + link
              </button>
              <button
                type="button"
                onClick={copyLinkOnly}
                className="px-3 py-1 rounded-full border border-gray-300 text-xs font-medium hover:bg-gray-100"
              >
                Copy link only
              </button>
            </div>
          </div>

          <p className="text-[11px] text-gray-500">
            On Instagram and TikTok, we copy this message to your clipboard and
            open their site. Paste it into a post, story, or DM so people can
            tap the profile link and see services, work and booking options.
          </p>
        </div>
      </div>
    </div>
  );
}