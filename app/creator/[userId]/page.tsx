// /workspaces/Vext/app/creator/[userId]/page.tsx
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
  businessLocationType?: 'shop' | 'mobile_only' | 'both';
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

  const [feedOpen, setFeedOpen] = useState(false);
  const [feedStartId, setFeedStartId] = useState<string | undefined>(undefined);

  const [user] = useAuthState(auth);
  const isOwner = user?.uid === userId;

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

  const avatarUrl =
    profile?.businessProfilePhoto || profile?.profilePhoto || '';

  const { fullAddress, mapsHref } = useMemo(() => {
    if (!profile) return { fullAddress: '', mapsHref: '' };

    if (profile.businessLocationType === 'mobile_only') {
      return {
        fullAddress: 'Mobile service — comes to your location',
        mapsHref: '',
      };
    }

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

  // ---------- load + redirect to handle URL if possible ----------
  useEffect(() => {
    if (!userId || typeof userId !== 'string') return;

    (async () => {
      const uRef = doc(db, 'users', userId);
      const uSnap = await getDoc(uRef);
      if (!uSnap.exists()) {
        setProfile(null);
        return;
      }

      const data = uSnap.data() as any;

      const personalHandle = normalizeHandle(
        data.personalUsername || data.username,
      );
      const businessHandle = normalizeHandle(data.businessUsername);
      const isProvider = !!(data.isProvider ?? data.isServiceProvider);

      // ✅ Redirect providers to their business handle page at /{handle}
      if (isProvider && businessHandle) {
        router.replace(`/${businessHandle}`);
        return;
      }

      // ✅ Redirect non-providers with a personal handle to /{handle}
      if (!isProvider && personalHandle) {
        router.replace(`/${personalHandle}`);
        return;
      }

      // Fallback: no handle yet → keep using UID-based creator page
      setProfile(data as UserProfile);

      const vidsQ = query(
        collection(db, 'videos'),
        where('userId', '==', userId),
      );
      const vidsSnap = await getDocs(vidsQ);
      setUploads(
        vidsSnap.docs.map(
          (d) => ({ id: d.id, ...(d.data() as any) }) as VideoDoc,
        ),
      );

      const followersSnap = await getDocs(
        collection(db, 'users', userId, 'followers'),
      );
      setFollowersCount(followersSnap.size);

      if (user) {
        const fdoc = await getDoc(
          doc(db, 'users', userId, 'followers', user.uid),
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
      {/* ... rest of your existing JSX stays unchanged ... */}
    </div>
  );
}