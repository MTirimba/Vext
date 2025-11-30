// /workspaces/Vext/app/c/[handle]/page.tsx
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
} from 'firebase/firestore';
import { db, auth } from '@/lib/firebase';
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
  personalUsername?: string;
  businessUsername?: string;
  fullName?: string;
  profilePhoto?: string;            // personal avatar
  businessProfilePhoto?: string;    // business avatar
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
        addr
      )}`;
    }

    return { fullAddress: addr, mapsHref: href };
  }, [profile]);

  // ---------- load everything from handle ----------
  useEffect(() => {
    if (!handle) return;

    setLoading(true);
    setNotFound(false);
    setResolvedUid(null);
    setProfile(null);
    setUploads([]);

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
              limit(1)
            )
          );

          // 2b) Try exact businessUsername == rawHandle (e.g. "Trimac")
          if (foundSnap.empty && rawHandle) {
            foundSnap = await getDocs(
              query(
                usersCol,
                where('businessUsername', '==', rawHandle),
                limit(1)
              )
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
            query(collection(db, 'users'), where('isProvider', '==', true))
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
        setProfile(uSnap.data() as UserProfile);

        // Uploads
        const vidsSnap = await getDocs(
          query(collection(db, 'videos'), where('userId', '==', uid))
        );
        setUploads(
          vidsSnap.docs.map((d) => ({ id: d.id, ...(d.data() as any) })) as VideoDoc[]
        );

        // Followers
        const followersSnap = await getDocs(
          collection(db, 'users', uid, 'followers')
        );
        setFollowersCount(followersSnap.size);

        // Following?
        if (user) {
          const fdoc = await getDoc(
            doc(db, 'users', uid, 'followers', user.uid)
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

  // ---------- main UI (very similar to /creator/[userId], but business-oriented) ----------
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
                  <MessageButton
                    currentUserId={user?.uid}
                    otherUserId={resolvedUid}
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
    </div>
  );
}