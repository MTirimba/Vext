// /workspaces/Vext/components/PostFeedModal.tsx
'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { auth, db } from '@/lib/firebase';
import { useAuthState } from 'react-firebase-hooks/auth';
import { doc, getDoc, setDoc, deleteDoc } from 'firebase/firestore';
import BookingModal from './BookingModal';
import { CommentModal } from './CommentModal';
import {
  FiHeart,
  FiMessageCircle,
  FiSend,
  FiMoreHorizontal,
  FiX,
} from 'react-icons/fi';
import {
  FaWhatsapp,
  FaFacebook,
  FaTwitter,
  FaEnvelope,
  FaInstagram,
} from 'react-icons/fa';
import { SiTiktok } from 'react-icons/si';
import { DEFAULT_MARKUP_TIERS, MarkupTier } from '@/lib/pricing';

type MediaItem = { url: string; type: 'image' | 'video' };
type Addon = { name: string; cost: number; unit: string };

export interface VideoDoc {
  id: string;
  userId?: string;
  url?: string;
  coverUrl?: string;
  hasCarousel?: boolean;
  media?: MediaItem[];
  title?: string;
  description?: string;
  category?: string;
  serviceCost?: number;
  addons?: Addon[];
  timeTaken?: { hours?: number; minutes?: number };
  specialInstructions?: string | null;
  serviceIncludes?: string[];
  notProvided?: string[];
}

export interface CreatorProfile {
  username?: string;
  fullName?: string;
  businessName?: string;
  profilePhoto?: string;
  businessProfilePhoto?: string; // for business avatar

  street?: string;
  building?: string;
  room?: string;
  town?: string;
  county?: string;
  location?: string;
  lat?: number;
  lng?: number;
  operatingHours?: string;
}

export function buildAddress(p?: CreatorProfile) {
  if (!p) return '';
  const parts: string[] = [];
  if (p.building) parts.push(p.building);
  if (p.room) parts.push(p.room);
  if (p.street) parts.push(p.street);
  if (p.town) parts.push(p.town);
  if (p.county) parts.push(p.county);
  if (!parts.length && p.location) parts.push(p.location);
  return parts.join(', ');
}

export function mapHref(p?: CreatorProfile) {
  if (!p) return '';
  if (typeof p.lat === 'number' && typeof p.lng === 'number') {
    return `https://www.google.com/maps?q=${p.lat},${p.lng}`;
  }
  const addr = buildAddress(p);
  return addr
    ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
        addr,
      )}`
    : '';
}

function firstMedia(v: VideoDoc): MediaItem | null {
  if (v.media?.length) return v.media[0];
  const src = v.coverUrl || v.url;
  if (!src) return null;
  const isImg = /\.(png|jpe?g|gif|webp|avif|bmp)$/i.test(src.split('?')[0]);
  return { url: src, type: isImg ? 'image' : 'video' };
}

// 💰 Helper: compute client-facing price from a base using markup tiers
function priceWithMarkup(
  base: number,
  tiers: MarkupTier[] = DEFAULT_MARKUP_TIERS,
): number | null {
  if (!Number.isFinite(base) || base <= 0) return null;
  const tier =
    tiers.find((t) => base >= t.min && (t.max == null || base < t.max)) ||
    tiers[tiers.length - 1];

  const percent = tier?.percent ?? 0;
  const multiplier = 1 + percent / 100;
  return Math.round(base * multiplier);
}

export function PostFeedModal({
  videos,
  startVideoId,
  creatorProfile,
  onClose,
}: {
  videos: VideoDoc[];
  startVideoId?: string;
  creatorProfile?: CreatorProfile;
  onClose: () => void;
}) {
  const [user] = useAuthState(auth);
  const [bookingFor, setBookingFor] = useState<VideoDoc | null>(null);
  const [commentForId, setCommentForId] = useState<string | null>(null);
  const [shareFor, setShareFor] = useState<VideoDoc | null>(null);

  // ----- scrolling infra
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const itemRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const setItemRef = (id: string) => (el: HTMLDivElement | null) => {
    itemRefs.current[id] = el;
  };

  // Jump to the clicked post
  useEffect(() => {
    if (!startVideoId) return;

    let tries = 0;
    const maxTries = 30;
    const tick = () => {
      const targetEl = itemRefs.current[startVideoId];
      if (targetEl) {
        targetEl.scrollIntoView({ behavior: 'auto', block: 'start' });
        return;
      }
      if (tries++ < maxTries) setTimeout(tick, 150);
    };
    const t0 = setTimeout(tick, 50);
    return () => clearTimeout(t0);
  }, [startVideoId, videos.length]);

  // ----- like state (same as VideoFeed; uses same Firestore subcollection)
  const [likesMap, setLikesMap] = useState<Record<string, boolean>>({});
  useEffect(() => {
    (async () => {
      if (!user) return setLikesMap({});
      const out: Record<string, boolean> = {};
      for (const v of videos) {
        const l = await getDoc(doc(db, 'videos', v.id, 'likes', user.uid));
        out[v.id] = l.exists();
      }
      setLikesMap(out);
    })().catch(() => {});
  }, [user, videos]);

  const toggleLike = async (vid: VideoDoc) => {
    if (!user) return alert('Sign in to like');
    const ref = doc(db, 'videos', vid.id, 'likes', user.uid);
    if (likesMap[vid.id]) {
      await deleteDoc(ref);
      setLikesMap((m) => ({ ...m, [vid.id]: false }));
    } else {
      await setDoc(ref, { likedAt: Date.now(), userId: user.uid });
      setLikesMap((m) => ({ ...m, [vid.id]: true }));
    }
  };

  // ✅ Use tiered markup instead of flat +10%
  const clientDisplayPrice = (v: VideoDoc) =>
    typeof v.serviceCost === 'number'
      ? priceWithMarkup(v.serviceCost)
      : null;

  const address = useMemo(() => buildAddress(creatorProfile), [creatorProfile]);
  const maps = useMemo(() => mapHref(creatorProfile), [creatorProfile]);

  // ----- Close on ESC
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const displayName =
    creatorProfile?.businessName ||
    creatorProfile?.fullName ||
    (creatorProfile?.username
      ? `@${creatorProfile.username}`
      : 'this creator');

  const avatarUrl =
    creatorProfile?.businessProfilePhoto || creatorProfile?.profilePhoto;

  return (
    <div
      className="fixed inset-0 z-[9999] bg-black/70 backdrop-blur-sm"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
    >
      {/* Close (X) button */}
      <button
        type="button"
        aria-label="Close"
        title="Close"
        onClick={(e) => {
          e.stopPropagation();
          onClose();
        }}
        className="absolute top-3 right-3 md:top-4 md:right-4 p-2 rounded-full bg-white/90 hover:bg-white shadow z-50 pointer-events-auto"
      >
        <FiX className="w-5 h-5 text-gray-800" />
      </button>

      <div
        ref={scrollerRef}
        className="absolute inset-0 overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="max-w-3xl mx-auto py-8 space-y-10">
          {videos.map((v) => {
            const cover = firstMedia(v);
            const price = clientDisplayPrice(v);
            return (
              <div
                key={v.id}
                ref={setItemRef(v.id)}
                className="bg-white rounded-lg overflow-hidden shadow-lg"
              >
                {/* media */}
                <div className="bg-black flex items-center justify-center">
                  {cover?.type === 'image' ? (
                    <img
                      src={cover.url}
                      alt={v.title || 'upload'}
                      className="max-h-[75vh] w-auto object-contain"
                      draggable={false}
                    />
                  ) : (
                    <video
                      src={cover?.url}
                      className="max-h-[75vh] w-auto"
                      controls
                      playsInline
                    />
                  )}
                </div>

                {/* meta row */}
                <div className="px-4 py-3 flex items-start justify-between">
                  <div className="min-w-0 pr-3">
                    {v.title && (
                      <div className="font-semibold text-sm truncate">
                        {v.title}
                      </div>
                    )}
                    {v.description && (
                      <div className="text-xs text-gray-600 line-clamp-2">
                        {v.description}
                      </div>
                    )}

                    {(address || maps) && (
                      <div className="text-xs text-gray-700 mt-1">
                        {address && <span>{address}</span>}
                        {maps && (
                          <>
                            {' • '}
                            <a
                              href={maps}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-blue-600 hover:underline"
                            >
                              map
                            </a>
                          </>
                        )}
                      </div>
                    )}
                    {creatorProfile?.operatingHours && (
                      <div className="text-xs text-gray-500">
                        {creatorProfile.operatingHours}
                      </div>
                    )}

                    {price !== null && (
                      <div className="inline-block mt-2 bg-black text-white text-[11px] font-bold px-2 py-1 rounded">
                        KSHS {price.toLocaleString()}
                      </div>
                    )}
                  </div>

                  <button
                    onClick={() => setBookingFor(v)}
                    className="shrink-0 bg-green-600 hover:bg-green-700 text-white text-sm px-3 py-1.5 rounded"
                  >
                    Book Service
                  </button>
                </div>

                {/* actions (like / comment / share) — shared behavior with VideoFeed */}
                <div className="px-4 pb-4 pt-1 border-t">
                  <div className="flex items-center gap-5 text-gray-700">
                    <button
                      onClick={() => toggleLike(v)}
                      className={`flex items-center gap-1 hover:opacity-75 ${
                        likesMap[v.id] ? 'text-red-500' : ''
                      }`}
                      aria-label="Like"
                    >
                      <FiHeart /> <span className="text-sm">Like</span>
                    </button>
                    <button
                      onClick={() => setCommentForId(v.id)}
                      className="flex items-center gap-1 hover:opacity-75"
                      aria-label="Comment"
                    >
                      <FiMessageCircle />{' '}
                      <span className="text-sm">Comment</span>
                    </button>
                    <button
                      onClick={() => setShareFor(v)}
                      className="flex items-center gap-1 hover:opacity-75"
                      aria-label="Share"
                    >
                      <FiSend /> <span className="text-sm">Share</span>
                    </button>
                    <div className="ml-auto text-gray-400">
                      <FiMoreHorizontal />
                    </div>
                  </div>
                </div>
              </div>
            );
          })}

          <div className="h-10" />
        </div>
      </div>

      {bookingFor && (
        <BookingModal video={bookingFor} onClose={() => setBookingFor(null)} />
      )}

      {commentForId && (
        <CommentModal
          videoId={commentForId}
          onClose={() => setCommentForId(null)}
        />
      )}

      {shareFor && (
        <PostShareModal
          video={shareFor}
          creatorProfile={creatorProfile}
          onClose={() => setShareFor(null)}
        />
      )}
    </div>
  );
}

/* -------------------------------------------------------
 * Post share modal – provider-voice caption + preview card
 * ----------------------------------------------------- */

function PostShareModal({
  video,
  creatorProfile,
  onClose,
}: {
  video: VideoDoc;
  creatorProfile?: CreatorProfile;
  onClose: () => void;
}) {
  const origin =
    typeof window !== 'undefined' ? window.location.origin : '';
  const videoUrl = origin && video.id ? `${origin}/video/${video.id}` : '';

  const displayName =
    creatorProfile?.businessName ||
    creatorProfile?.fullName ||
    (creatorProfile?.username
      ? `@${creatorProfile.username}`
      : 'this creator');

  const avatarUrl =
    creatorProfile?.businessProfilePhoto || creatorProfile?.profilePhoto;

  // Provider-voice caption
  const shareText = `Check out ${displayName} on VextUp – see the services we offer, view our work and book directly here: ${videoUrl}`;

  const copyText = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      alert('Share text copied to clipboard!');
    } catch (err) {
      console.error('copy failed', err);
      alert('Could not copy text.');
    }
  };

  const copyLinkOnly = async () => {
    try {
      await navigator.clipboard.writeText(videoUrl);
      alert('Link copied to clipboard!');
    } catch (err) {
      console.error('copy failed', err);
      alert('Could not copy link.');
    }
  };

  const openWindow = (url: string) => {
    window.open(url, '_blank', 'noopener,noreferrer');
  };

  const handleWhatsapp = () => {
    openWindow(`https://wa.me/?text=${encodeURIComponent(shareText)}`);
  };

  const handleFacebook = () => {
    openWindow(
      `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(
        videoUrl,
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

  const handleInstagram = async () => {
    await copyText(shareText);
    openWindow('https://www.instagram.com/');
  };

  const handleTiktok = async () => {
    await copyText(shareText);
    openWindow('https://www.tiktok.com/');
  };

  return (
    <div
      className="fixed inset-0 z-[10000] bg-black/60 flex items-center justify-center"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-lg shadow-xl w-[95vw] max-w-md p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold">Share service</h2>
          <button
            type="button"
            onClick={onClose}
            className="text-xs text-gray-500 hover:text-gray-800"
          >
            Close
          </button>
        </div>

        {/* Preview card with business avatar + name + link */}
        <div className="flex items-center gap-3 mb-4 border rounded-lg p-2 bg-gray-50">
          {avatarUrl ? (
            <img
              src={avatarUrl}
              alt={displayName}
              className="w-10 h-10 rounded-full object-cover"
            />
          ) : (
            <div className="w-10 h-10 rounded-full bg-gray-300" />
          )}
          <div className="text-xs">
            <div className="font-semibold text-gray-900">{displayName}</div>
            <div className="text-gray-600 truncate max-w-[210px]">
              See the services we offer, view our work and book directly on
              VextUp.
            </div>
            <div className="text-[10px] text-blue-600 truncate">
              {videoUrl}
            </div>
          </div>
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
            <p className="text-xs text-gray-600 mb-1">
              Message &amp; link
            </p>
            <textarea
              readOnly
              value={shareText}
              className="w-full border rounded px-2 py-2 text-xs bg-gray-50 h-16 resize-none"
            />
            <div className="mt-2 flex gap-2">
              <button
                type="button"
                onClick={() => copyText(shareText)}
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
            On Instagram and TikTok, we copy this message to your clipboard
            and open their site. Paste it into a post, story, or DM so people
            can tap the link and see your services, work and booking options.
          </p>
        </div>
      </div>
    </div>
  );
}

export default PostFeedModal;