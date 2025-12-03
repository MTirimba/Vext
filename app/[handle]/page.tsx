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

        // 2) Fallback: try direct Firestore queries
        if (!uid) {
          const usersCol = collection(db, 'users');
          let foundSnap = await getDocs(
            query(
              usersCol,
              where('businessUsernameLower', '==', handle),
              limit(1),
            ),
          );

          // 2b) Try exact businessUsername == rawHandle (e.g. "Trimac")
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

        // 3) Last-resort fallback: scan providers & match in JS by normalized businessUsername
        if (!uid) {
          const providersSnap = await getDocs(
            query(collection(db, 'users'), where('isProvider', '==', true)),
          );

          let foundUid: string | null = null;
          providersSnap.forEach((docSnap) => {
            if (foundUid) return;
            const d = docSnap.data() as any;
            const bh = normalizeHandle(d.businessUsername);
            if (bh && bh === handle) {
              foundUid = docSnap.id;
            }
          });

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

      let conversationId = existingId;
      if (!conversationId) {
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
      <div className="min-h-screen flex flex-col items-center justify-center bg-white">
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

      <div className="max-w-5xl mx-auto pb-10 pt-8 sm:pt-12">
        {/* Header — Instagram-like */}
        <div className="px-4 sm:px-6">
          <div className="flex flex-col sm:flex-row sm:items-center sm:gap-10">
            {/* avatar */}
            <div className="flex justify-center sm:block">
              <div className="w-28 h-28 sm:w-36 sm:h-36 rounded-full overflow-hidden ring-2 ring-gray-200">
                {avatarUrl ? (
                  <img
                    src={avatarUrl}
                    alt={displayName}
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <div className="w-full h-full bg-gray-200" />
                )}
              </div>
            </div>

            {/* name + actions */}
            <div className="mt-4 sm:mt-0 flex-1">
              <div className="flex items-center gap-3 flex-wrap">
                <h1 className="text-2xl sm:text-3xl font-semibold">
                  {displayName}
                </h1>

                {/* Follow / Message / Share (viewer only for follow/message) */}
                {user?.uid !== resolvedUid && resolvedUid && (
                  <>
                    <button
                      onClick={toggleFollow}
                      className={`px-4 py-1 rounded text-sm font-medium ${
                        isFollowing
                          ? 'bg-gray-200'
                          : 'bg-blue-500 text-white hover:bg-blue-600'
                      }`}
                      aria-label={isFollowing ? 'Following' : 'Follow'}
                      title={isFollowing ? 'Following' : 'Follow'}
                    >
                      {isFollowing ? 'Following' : 'Follow'}
                    </button>
                    <button
                      type="button"
                      onClick={handleMessageClick}
                      className="px-3 py-1 rounded-full border border-gray-300 text-sm flex items-center gap-1 text-gray-700 hover:bg-gray-100"
                    >
                      <span>Message</span>
                    </button>
                  </>
                )}
                <button
                  type="button"
                  onClick={() => setShareOpen(true)}
                  className="px-3 py-1 rounded-full border border-gray-300 text-sm flex items-center gap-1 text-gray-700 hover:bg-gray-100"
                  title="Share profile"
                >
                  <FiShare2 className="text-gray-600" />
                  <span className="hidden sm:inline">Share</span>
                </button>
              </div>

              {/* stats line with icons + services button */}
              <div className="flex flex-wrap items-center gap-4 mt-3 text-sm text-gray-700">
                <span className="flex items-center gap-1">
                  <FiImage className="text-gray-600" />
                  <b>{uploads.length}</b> posts
                </span>
                <span className="flex items-center gap-1">
                  <FiUsers className="text-gray-600" />
                  <b>{followersCount}</b> followers
                </span>
                <button
                  type="button"
                  onClick={() => setServicesListOpen(true)}
                  className="px-3 py-1 rounded-full border border-gray-300 text-xs font-medium text-gray-700 hover:bg-gray-100"
                >
                  Services offered
                </button>
              </div>

              {/* Full location + map link */}
              {(fullAddress || mapsHref) && (
                <div className="mt-3 text-sm text-gray-800 flex items-start gap-2">
                  <FiMapPin className="mt-0.5 shrink-0 text-gray-600" />
                  <div>
                    {fullAddress && <div>{fullAddress}</div>}
                    {mapsHref && (
                      <a
                        href={mapsHref}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-blue-600 hover:underline text-sm"
                      >
                        View on map
                      </a>
                    )}
                  </div>
                </div>
              )}

              {profile.operatingHours && (
                <div className="mt-2 text-sm text-gray-700 flex items-start gap-2">
                  <FiClock className="mt-0.5 shrink-0 text-gray-600" />
                  <span>{profile.operatingHours}</span>
                </div>
              )}

              {profile.servicesProvided && (
                <div className="mt-2 text-sm text-gray-600">
                  {profile.servicesProvided}
                </div>
              )}

              {profile.bio && (
                <div className="mt-2 text-sm text-gray-700">
                  {profile.bio}
                </div>
              )}
            </div>
          </div>

          {/* Tabs (visual only) */}
          <div className="border-t mt-8 flex justify-center">
            <div className="flex items-center gap-8 text-xs tracking-widest uppercase text-gray-500">
              <div className="flex items-center gap-1 py-3 border-t-2 border-black text-black">
                <FiGrid /> Posts
              </div>
              <div className="flex items-center gap-1 py-3 opacity-60">
                <FiFilm /> Reels
              </div>
            </div>
          </div>
        </div>

        {/* Grid of posts */}
        <div className="px-2 sm:px-0 mt-6">
          {uploads.length === 0 ? (
            <p className="text-center text-gray-500 mt-10">No uploads yet.</p>
          ) : (
            <div className="grid grid-cols-3 gap-1 sm:gap-2 mt-2">
              {uploads.map((v) => {
                const cover = firstMedia(v);
                const stacked =
                  !!v.hasCarousel || (v.media && v.media.length > 1);

                return (
                  <button
                    key={v.id}
                    className="relative group bg-gray-100 aspect-square overflow-hidden"
                    onClick={() => {
                      setFeedStartId(v.id);
                      setFeedOpen(true);
                    }}
                  >
                    {cover?.type === 'image' ? (
                      <img
                        src={cover.url}
                        alt={v.title || 'upload'}
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <video
                        src={cover?.url}
                        muted
                        playsInline
                        loop
                        className="w-full h-full object-cover"
                      />
                    )}

                    {/* stacked indicator */}
                    {stacked && (
                      <div className="absolute top-2 right-2 text-white/95 drop-shadow-[0_1px_1px_rgba(0,0,0,0.8)]">
                        <div className="relative w-5 h-5">
                          <span className="absolute inset-0 rounded-sm bg-black/40 border border-white/30" />
                          <span className="absolute -top-1 -right-1 w-5 h-5 rounded-sm bg-black/40 border border-white/30" />
                        </div>
                      </div>
                    )}

                    {/* owner tools */}
                    {isOwner && (
                      <div className="absolute top-2 left-2 flex gap-2 opacity-0 group-hover:opacity-100 transition">
                        <span
                          onClick={(e) => {
                            e.stopPropagation();
                            setEditingVideo(v);
                          }}
                          className="p-1 rounded-full bg-black/60 text-white hover:bg-black/80 cursor-pointer"
                          title="Edit"
                          aria-label="Edit"
                        >
                          <FiEdit2 />
                        </span>
                        <span
                          onClick={(e) => {
                            e.stopPropagation();
                            handleDelete(v);
                          }}
                          className="p-1 rounded-full bg-black/60 text-white hover:bg-black/80 cursor-pointer"
                          title="Delete"
                          aria-label="Delete"
                        >
                          <FiTrash2 />
                        </span>
                      </div>
                    )}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {editingVideo && (
          <EditVideoModal
            video={editingVideo}
            onClose={() => setEditingVideo(null)}
          />
        )}

        {feedOpen && (
          <PostFeedModal
            videos={uploads}
            startVideoId={feedStartId}
            creatorProfile={profile}
            onClose={() => setFeedOpen(false)}
          />
        )}

        {bookingService && resolvedUid && (
          <BookingModal
            video={
              {
                id: `svc_${bookingService.id}`,
                title: bookingService.name,
                serviceCost: bookingService.basePrice, // base price; markup applied in client views
                timeTaken: {
                  hours: Math.floor(bookingService.durationMinutes / 60),
                  minutes: bookingService.durationMinutes % 60,
                },
                userId: resolvedUid,
              } as any
            }
            creator={profile as any}
            onClose={() => setBookingService(null)}
          />
        )}
      </div>

      {/* SERVICES LIST MODAL */}
      {servicesListOpen && (
        <div className="fixed inset-0 z-40 bg-black/60 flex items-center justify-center">
          <div className="bg-white rounded-lg w-[92vw] max-w-lg max-h-[80vh] flex flex-col shadow-xl">
            <div className="px-4 py-3 border-b flex items-center justify-between">
              <div>
                <h3 className="text-sm font-semibold text-gray-900">
                  Services offered
                </h3>
                <p className="text-[11px] text-gray-500">
                  See what this provider offers and book directly.
                </p>
              </div>
              <div className="flex items-center gap-2">
                {isOwner && (
                  <button
                    type="button"
                    onClick={openAddServiceModal}
                    className="px-3 py-1 rounded-full bg-[#0F7A5F] text-white text-xs hover:opacity-90"
                  >
                    Add service
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setServicesListOpen(false)}
                  className="text-xs text-gray-500 hover:text-gray-800"
                >
                  Close
                </button>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto px-4 py-3 space-y-2">
              {servicesOffered.length === 0 && (
                <p className="text-xs text-gray-500">
                  {isOwner
                    ? 'You have not added any services yet. Use “Add service” to list what you offer along with prices.'
                    : "This provider hasn't listed any services yet."}
                </p>
              )}

              {servicesOffered.map((svc) => {
                const base = svc.basePrice || 0;
                const displayed = isOwner
                  ? base
                  : applyMarkup(base, markupConfig);
                const mins = svc.durationMinutes || 0;
                const hrs = mins ? Math.floor(mins / 60) : 0;
                const remMins = mins ? mins % 60 : 0;

                return (
                  <div
                    key={svc.id}
                    className="flex items-center justify-between border rounded-lg px-3 py-2 text-sm"
                  >
                    <div className="flex-1 mr-3">
                      <div className="font-medium text-gray-900">
                        {svc.name}
                      </div>
                      <div className="text-xs text-gray-600 mt-0.5">
                        {isOwner ? (
                          <>
                            Base price:{' '}
                            <span className="font-semibold">
                              KSHS {base.toLocaleString()}
                            </span>
                            {' · '}
                            Clients currently see approx.{` `}
                            <span className="font-semibold">
                              KSHS {displayed.toLocaleString()}
                            </span>{' '}
                            (includes platform fee based on price bracket).
                          </>
                        ) : (
                          <>
                            From{' '}
                            <span className="font-semibold">
                              KSHS {displayed.toLocaleString()}
                            </span>
                          </>
                        )}
                        {mins > 0 && (
                          <>
                            {' · '}
                            {hrs > 0 && `${hrs} hr`}
                            {hrs > 0 && remMins > 0 && ' '}
                            {remMins > 0 && `${remMins} min`}
                          </>
                        )}
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      {isOwner && (
                        <button
                          type="button"
                          onClick={() => openEditServiceModal(svc)}
                          className="px-2 py-1 text-xs rounded border border-gray-300 text-gray-700 hover:bg-gray-100"
                        >
                          Edit
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => openBookingForService(svc)}
                        className="px-3 py-1 text-xs rounded bg-[#0F7A5F] text-white hover:opacity-90"
                      >
                        Book
                      </button>
                    </div>
                  </div>
                );
              })}

              {isOwner && servicesOffered.length > 0 && (
                <p className="mt-2 text-[11px] text-gray-500">
                  Clients see your prices with a small platform fee added on top
                  (the exact percentage depends on the price bracket). You still
                  receive the base price you set here.
                </p>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Add / edit service modal */}
      {serviceModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center">
          <div className="bg-white rounded-lg w-[90vw] max-w-md p-4 shadow-lg">
            <h3 className="text-base font-semibold mb-3">
              {editingService ? 'Edit service' : 'Add service'}
            </h3>

            <label className="block text-sm mb-3">
              <span className="block mb-1">Service name</span>
              <input
                type="text"
                value={serviceNameInput}
                onChange={(e) => setServiceNameInput(e.target.value)}
                className="w-full border rounded px-3 py-2 text-sm"
                placeholder="e.g., Silk press, Haircut, Pedicure"
              />
            </label>

            <label className="block text-sm mb-3">
              <span className="block mb-1">Base price (what you charge)</span>
              <div className="flex items-center">
                <span className="mr-2 text-xs font-semibold">KSHS</span>
                <input
                  type="number"
                  min={0}
                  value={servicePriceInput}
                  onChange={(e) =>
                    setServicePriceInput(Number(e.target.value) || '')
                  }
                  className="flex-1 border rounded px-3 py-2 text-sm"
                  placeholder="e.g., 1500"
                />
              </div>
              <p className="mt-1 text-[11px] text-gray-500">
                Clients see this with a small platform fee added on top. The
                percentage varies by price bracket, but you still receive the
                base price you set here.
              </p>
            </label>

            <div className="mb-4 text-sm">
              <span className="block mb-1">Service duration (required)</span>
              <div className="flex gap-2">
                <div className="flex-1">
                  <input
                    type="number"
                    min={0}
                    value={serviceHoursInput}
                    onChange={(e) =>
                      setServiceHoursInput(Number(e.target.value) || '')
                    }
                    className="w-full border rounded px-2 py-1 text-sm"
                  />
                  <div className="text-[11px] text-gray-500 mt-0.5">hrs</div>
                </div>
                <div className="flex-1">
                  <input
                    type="number"
                    min={0}
                    max={59}
                    value={serviceMinutesInput}
                    onChange={(e) =>
                      setServiceMinutesInput(Number(e.target.value) || '')
                    }
                    className="w-full border rounded px-2 py-1 text-sm"
                  />
                  <div className="text-[11px] text-gray-500 mt-0.5">min</div>
                </div>
              </div>
              <p className="mt-1 text-[11px] text-gray-500">
                This helps the booking calendar know how long to reserve and
                which times to block out.
              </p>
            </div>

            <div className="flex justify-end gap-2 text-sm">
              <button
                type="button"
                onClick={() => {
                  setServiceModalOpen(false);
                  setEditingService(null);
                }}
                className="px-3 py-1.5 rounded bg-gray-200 text-gray-800 hover:bg-gray-300"
                disabled={savingService}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSaveService}
                className="px-4 py-1.5 rounded bg-[#0F7A5F] text-white hover:opacity-90 disabled:opacity-60"
                disabled={savingService}
              >
                {savingService ? 'Saving…' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Share modal */}
      {shareOpen && (
        <ProfileShareModal
          open={shareOpen}
          onClose={() => setShareOpen(false)}
          profileUrl={profileUrl}
          displayName={displayName}
          avatarUrl={avatarUrl}
        />
      )}
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