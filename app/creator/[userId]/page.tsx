'use client';

import { useEffect, useMemo, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import {
  collection,
  getDoc,
  getDocs,
  query,
  where,
  doc,
  setDoc,
  deleteDoc,
} from 'firebase/firestore';
import { db, auth } from '@/lib/firebase';
import { useAuthState } from 'react-firebase-hooks/auth';
import MessageButton from '@/components/MessageButton';
import { EditVideoModal } from '@/components/EditVideoModal';
import { PostFeedModal } from '@/components/PostFeedModal';
import {
  FiEdit2,
  FiTrash2,
  FiGrid,
  FiFilm,
  FiMapPin,
  FiClock,
  FiImage,
  FiUsers,
} from 'react-icons/fi';

interface UserProfile {
  username?: string;
  fullName?: string;
  profilePhoto?: string;            // personal
  businessProfilePhoto?: string;    // business avatar
  isServiceProvider?: boolean;      // legacy flag; new code may use isProvider
  isProvider?: boolean;             // new flag name in some places
  businessName?: string;
  servicesProvided?: string;
  location?: string;      // generic town/area
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
  // handles (may or may not be present on older users)
  personalUsername?: string;
  businessUsername?: string;
}

type MediaItem = { url: string; type: 'image' | 'video' };

interface VideoDoc {
  id: string;
  userId?: string;
  url?: string;                     // legacy
  coverUrl?: string;                // new
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

function normalizeHandle(v?: string | null) {
  return (v || '').trim().toLowerCase();
}

export default function CreatorProfilePage() {
  const { userId } = useParams() as { userId: string };
  const router = useRouter();

  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [uploads, setUploads] = useState<VideoDoc[]>([]);
  const [followersCount, setFollowersCount] = useState<number>(0);
  const [isFollowing, setIsFollowing] = useState<boolean>(false);
  const [editingVideo, setEditingVideo] = useState<VideoDoc | null>(null);

  // open modal feed at clicked post
  const [feedOpen, setFeedOpen] = useState(false);
  const [feedStartId, setFeedStartId] = useState<string | undefined>(undefined);

  const [user] = useAuthState(auth);
  const isOwner = user?.uid === userId;

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
      profile.fullName ||
      `@${profile.username || 'unknown'}`
    );
  }, [profile]);

  // Prefer businessProfilePhoto, then fallback to personal profilePhoto
  const avatarUrl = profile?.businessProfilePhoto || profile?.profilePhoto || '';

  // Build a friendly full address and a maps link
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
        addr
      )}`;
    }

    return { fullAddress: addr, mapsHref: href };
  }, [profile]);

  // ---------- load + redirect to handle URL if possible ----------
  useEffect(() => {
    if (!userId || typeof userId !== 'string') return;

    (async () => {
      // Fetch the user by uid
      const uRef = doc(db, 'users', userId);
      const uSnap = await getDoc(uRef);
      if (!uSnap.exists()) {
        setProfile(null);
        return;
      }

      const data = uSnap.data() as any;

      const personalHandle = normalizeHandle(
        data.personalUsername || data.username
      );
      const businessHandle = normalizeHandle(data.businessUsername);
      const isProvider = !!(data.isProvider ?? data.isServiceProvider);

      // If this is a provider with a business handle -> redirect to /c/{handle}
      if (isProvider && businessHandle) {
        router.replace(`/c/${businessHandle}`);
        return;
      }

      // If this is a non-provider with a personal handle -> redirect to /u/{handle}
      if (!isProvider && personalHandle) {
        router.replace(`/u/${personalHandle}`);
        return;
      }

      // Fallback: no handle yet → keep using UID-based creator page
      setProfile(data as UserProfile);

      // uploads (by uid)
      const vidsQ = query(
        collection(db, 'videos'),
        where('userId', '==', userId)
      );
      const vidsSnap = await getDocs(vidsQ);
      setUploads(
        vidsSnap.docs.map((d) => ({ id: d.id, ...(d.data() as any) })) as VideoDoc[]
      );

      // followers
      const followersSnap = await getDocs(
        collection(db, 'users', userId, 'followers')
      );
      setFollowersCount(followersSnap.size);

      // following?
      if (user) {
        const fdoc = await getDoc(
          doc(db, 'users', userId, 'followers', user.uid)
        );
        setIsFollowing(fdoc.exists());
      }
    })().catch(console.error);
  }, [userId, user, router]);

  // ---------- actions ----------
  const toggleFollow = async () => {
    if (!user) return alert('Sign in to follow creators');
    const ref = doc(db, 'users', userId, 'followers', user.uid);
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
    if (!isOwner) return;
    if (!confirm('Delete this upload?')) return;
    await deleteDoc(doc(db, 'videos', vid.id));
    setUploads((prev) => prev.filter((u) => u.id !== vid.id));
  };

  // ---------- UI ----------
  if (!profile) {
    return (
      <p className="text-center mt-20 text-gray-500">
        Loading creator profile…
      </p>
    );
  }

  return (
    <div className="max-w-5xl mx-auto pb-10">
      {/* Header — Instagram-like */}
      <div className="px-4 pt-8 sm:pt-12 sm:px-6">
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

              {/* Follow / Message (viewer only) */}
              {user?.uid !== userId && (
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
                  <MessageButton
                    otherUserId={userId}
                    redirectToList
                  />
                </>
              )}
            </div>

            {/* stats line with icons */}
            <div className="flex gap-6 mt-3 text-sm text-gray-700">
              <span className="flex items-center gap-1">
                <FiImage className="text-gray-600" />
                <b>{uploads.length}</b> posts
              </span>
              <span className="flex items-center gap-1">
                <FiUsers className="text-gray-600" />
                <b>{followersCount}</b> followers
              </span>
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

            {/* Operating hours */}
            {profile.operatingHours && (
              <div className="mt-2 text-sm text-gray-700 flex items-start gap-2">
                <FiClock className="mt-0.5 shrink-0 text-gray-600" />
                <span>{profile.operatingHours}</span>
              </div>
            )}

            {/* Optional services line */}
            {profile.servicesProvided && (
              <div className="mt-2 text-sm text-gray-600">
                {profile.servicesProvided}
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

      {/* Grid */}
      <div className="px-2 sm:px-0">
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
                    // OPEN FEED AT THE CLICKED POST
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

                  {/* stacked indicator (like Instagram multiple) */}
                  {stacked && (
                    <div className="absolute top-2 right-2 text-white/95 drop-shadow-[0_1px_1px_rgba(0,0,0,0.8)]">
                      <div className="relative w-5 h-5">
                        <span className="absolute inset-0 rounded-sm bg-black/40 border border-white/30" />
                        <span className="absolute -top-1 -right-1 w-5 h-5 rounded-sm bg-black/40 border border.white/30" />
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

      {/* Feed modal that autoscrolls to the clicked post */}
      {feedOpen && (
        <PostFeedModal
          videos={uploads}
          startVideoId={feedStartId}
          creatorProfile={profile}
          onClose={() => setFeedOpen(false)}
        />
      )}
    </div>
  );
}