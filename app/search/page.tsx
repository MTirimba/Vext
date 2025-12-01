'use client';

import { useEffect, useMemo, useState, FormEvent } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import algoliasearch from 'algoliasearch/lite';
import {
  InstantSearch,
  useSearchBox,
  useHits,
} from 'react-instantsearch-hooks-web';
import { db } from '@/lib/firebase';
import {
  collection,
  getDocs,
} from 'firebase/firestore';
import { FaArrowLeft } from 'react-icons/fa';

const searchClient = algoliasearch(
  process.env.NEXT_PUBLIC_ALGOLIA_APP_ID!,
  process.env.NEXT_PUBLIC_ALGOLIA_SEARCH_KEY!
);

const ALGOLIA_INDEX =
  (process.env.NEXT_PUBLIC_ALGOLIA_INDEX || 'videos').trim();

type TabKey = 'media' | 'providers' | 'users';

interface VideoHit {
  objectID: string;
  id?: string;
  title?: string;
  description?: string;
  url?: string;
  coverUrl?: string;
  media?: { url: string; type?: 'image' | 'video' }[];
  serviceCost?: number;
  userId?: string;
  contentType?: string;
}

interface UserProfile {
  id: string;
  username?: string;
  personalUsername?: string;
  businessUsername?: string;
  fullName?: string;
  businessName?: string;
  profilePhoto?: string;
  businessProfilePhoto?: string;
  isProvider?: boolean;
  location?: string;
  email?: string;
}

/* ------------------------- helpers ------------------------- */

function normalizeHandle(v?: string | null) {
  return (v || '').trim().toLowerCase();
}

function isImageUrl(url: string | undefined | null) {
  if (!url) return false;
  const u = url.split('?')[0].toLowerCase();
  return (
    /\.(png|jpe?g|gif|webp|avif|bmp)$/.test(u) || url.startsWith('data:image')
  );
}

function matchesUser(u: UserProfile, term: string) {
  if (!term) return true;
  const t = term.toLowerCase();
  const fields = [
    u.fullName,
    u.businessName,
    u.username,
    u.personalUsername,
    u.businessUsername,
    u.email,
    u.location,
  ];
  return fields.some((f) => f && f.toLowerCase().includes(t));
}

/* -------------------- Search bar bound to URL -------------------- */

function SearchBar({
  initialQuery,
  onSearchCommitted,
}: {
  initialQuery: string;
  onSearchCommitted: (q: string) => void;
}) {
  const { refine } = useSearchBox();
  const [value, setValue] = useState(initialQuery);

  useEffect(() => {
    setValue(initialQuery);
    refine(initialQuery);
  }, [initialQuery, refine]);

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    onSearchCommitted(value.trim());
  };

  return (
    <form onSubmit={onSubmit} className="w-full">
      <input
        className="w-full rounded-full bg-neutral-900 text-white px-4 py-2 text-sm border border-white/10 focus:outline-none focus:ring-2 focus:ring-emerald-500/70"
        placeholder="Search services, providers, or users…"
        value={value}
        onChange={(e) => {
          const v = e.target.value;
          setValue(v);
          refine(v);
        }}
      />
    </form>
  );
}

/* --------------------------- Media grid --------------------------- */

function MediaHitsGrid({
  query,
  providerIdsForFallback,
  onSelectMedia,
}: {
  query: string;
  providerIdsForFallback: string[];
  onSelectMedia: (id: string) => void;
}) {
  const { hits } = useHits<VideoHit>();
  const [fallbackVideos, setFallbackVideos] = useState<VideoHit[]>([]);

  const algoliaHits = hits as VideoHit[];

  // Fallback: if Algolia returns no hits but we have matching providers,
  // show their videos from Firestore so the Media tab isn't empty.
  useEffect(() => {
    const run = async () => {
      const trimmed = query.trim();
      const providerIds = providerIdsForFallback.slice(0, 10); // Firestore "in" max = 10

      if (algoliaHits.length > 0 || !trimmed || providerIds.length === 0) {
        setFallbackVideos([]);
        return;
      }

      try {
        // You can add Firestore fallback again here if you want.
        setFallbackVideos([]);
      } catch (err) {
        console.error('fallback videos error', err);
        setFallbackVideos([]);
      }
    };
    run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, JSON.stringify(providerIdsForFallback), algoliaHits.length]);

  const effectiveHits = algoliaHits.length ? algoliaHits : fallbackVideos;

  if (!query.trim()) {
    return (
      <div className="pt-10 text-center text-sm text-gray-400">
        Type something above to search media.
      </div>
    );
  }

  if (!effectiveHits.length) {
    return (
      <div className="pt-10 text-center text-sm text-gray-400">
        No media matches this search yet.
      </div>
    );
  }

  return (
    <div className="mt-4 grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
      {effectiveHits.map((hit) => {
        const id = hit.id || hit.objectID;
        const thumb =
          hit.coverUrl ||
          (hit.media && hit.media[0]?.url) ||
          hit.url ||
          '';

        const image = isImageUrl(thumb);

        const displayPrice =
          typeof hit.serviceCost === 'number'
            ? Math.round(hit.serviceCost * 1.1)
            : null;

        return (
          <button
            key={id}
            type="button"
            onClick={() => onSelectMedia(id)}
            className="flex flex-col text-left bg-white/5 border border-white/10 rounded-xl overflow-hidden hover:border-emerald-500/60 transition"
          >
            <div className="w-full aspect-[9/16] bg-black overflow-hidden">
              {image ? (
                <img
                  src={thumb}
                  alt={hit.title || 'service media'}
                  className="w-full h-full object-cover"
                />
              ) : thumb ? (
                <video
                  src={thumb}
                  muted
                  playsInline
                  preload="metadata"
                  className="w-full h-full object-cover"
                />
              ) : (
                <div className="w-full h-full flex items-center justify-center text-xs text-gray-500">
                  No preview
                </div>
              )}
            </div>

            {/* details below thumbnail */}
            <div className="px-2.5 py-2 space-y-1">
              <p className="text-sm font-semibold text-white line-clamp-1">
                {hit.title || 'Untitled service'}
              </p>
              {hit.description && (
                <p className="text-xs text-gray-400 line-clamp-2">
                  {hit.description}
                </p>
              )}
              {displayPrice !== null && (
                <p className="text-xs font-semibold text-emerald-300 mt-1">
                  KSHS {displayPrice.toLocaleString()}
                </p>
              )}
            </div>
          </button>
        );
      })}
    </div>
  );
}

/* ------------------------- People list (providers / users) ------------------------- */

function PeopleList({
  people,
  label,
}: {
  people: UserProfile[];
  label: 'providers' | 'users';
}) {
  const router = useRouter();

  if (!people.length) {
    return (
      <div className="text-sm text-gray-400 pt-6 text-center">
        No {label === 'providers' ? 'service providers' : 'users'} match this
        search.
      </div>
    );
  }

  return (
    <div className="flex flex-col divide-y divide-white/5 rounded-xl bg-white/5 border border-white/10 overflow-hidden mt-3">
      {people.map((p) => {
        const avatar =
          label === 'providers'
            ? p.businessProfilePhoto || p.profilePhoto
            : p.profilePhoto || p.businessProfilePhoto;

        const personalHandle = normalizeHandle(
          p.personalUsername || p.username
        );
        const businessHandle = normalizeHandle(
          p.businessUsername || personalHandle
        );
        const handle =
          label === 'providers' ? businessHandle : personalHandle;

        // Decide where clicking takes you
        let target = '/';
        if (label === 'providers') {
          // 👇 Pretty URL for providers: /{handle}
          target = handle ? `/${handle}` : `/creator/${p.id}`;
        } else {
          // Personal profiles remain /u/{handle}
          target = handle ? `/u/${handle}` : '/profile';
        }

        return (
          <button
            key={p.id}
            type="button"
            onClick={() => router.push(target)}
            className="flex items-center gap-3 px-3 py-2.5 hover:bg-white/5 text-left"
          >
            {avatar ? (
              <img
                src={avatar}
                alt={p.businessName || p.fullName || handle || 'avatar'}
                className="w-10 h-10 rounded-full object-cover border border-white/30"
              />
            ) : (
              <div className="w-10 h-10 rounded-full bg-gray-700 flex items-center justify-center text-xs font-semibold">
                {(p.businessName || p.fullName || handle || 'U')
                  .toUpperCase()
                  .slice(0, 2)}
              </div>
            )}

            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-white truncate">
                {p.businessName || p.fullName || handle || 'Unnamed'}
              </p>
              {handle && (
                <p className="text-xs text-gray-400 truncate">@{handle}</p>
              )}
              {p.location && (
                <p className="text-[11px] text-gray-500 truncate">
                  {p.location}
                </p>
              )}
            </div>

            {label === 'providers' && (
              <span className="text-[11px] px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-300 border border-emerald-400/30">
                Provider
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

/* ----------------------------- Inner search page (inside InstantSearch) ----------------------------- */

function SearchInner() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const initialQuery = (searchParams.get('q') || '').trim();
  const initialTab = (searchParams.get('tab') as TabKey) || 'media';

  const [activeTab, setActiveTab] = useState<TabKey>(initialTab);
  const [query, setQuery] = useState(initialQuery);

  // Load all users once; we'll filter locally for now.
  const [allProviders, setAllProviders] = useState<UserProfile[]>([]);
  const [allUsers, setAllUsers] = useState<UserProfile[]>([]);

  useEffect(() => {
    (async () => {
      try {
        const snap = await getDocs(collection(db, 'users'));
        const providers: UserProfile[] = [];
        const users: UserProfile[] = [];

        snap.forEach((docSnap) => {
          const d = docSnap.data() as any;
          const base: UserProfile = {
            id: docSnap.id,
            username: d.username || '',
            personalUsername: d.personalUsername || d.username || '',
            businessUsername: d.businessUsername || '',
            fullName: d.fullName || '',
            businessName: d.businessName || '',
            profilePhoto: d.profilePhoto || '',
            businessProfilePhoto: d.businessProfilePhoto || '',
            isProvider: !!d.isProvider,
            location: d.location || '',
            email: d.email || '',
          };

          if (base.isProvider) providers.push(base);
          users.push(base);
        });

        setAllProviders(providers);
        setAllUsers(users);
      } catch (err) {
        console.error('users fetch error', err);
      }
    })();
  }, []);

  const filteredProviders = useMemo(
    () => allProviders.filter((p) => matchesUser(p, query)),
    [allProviders, query]
  );

  const filteredUsers = useMemo(
    () => allUsers.filter((u) => matchesUser(u, query)),
    [allUsers, query]
  );

  const providerIdsForFallback = filteredProviders.map((p) => p.id);

  const handleBack = () => {
    router.back();
  };

  const commitSearchToUrl = (q: string) => {
    setQuery(q);
    const params = new URLSearchParams();
    if (q) params.set('q', q);
    params.set('tab', activeTab);
    router.replace(`/search?${params.toString()}`);
  };

  const changeTab = (tab: TabKey) => {
    setActiveTab(tab);
    const params = new URLSearchParams();
    if (query) params.set('q', query);
    params.set('tab', tab);
    router.replace(`/search?${params.toString()}`);
  };

  const handleSelectMedia = (id: string) => {
    try {
      if (typeof window !== 'undefined') {
        localStorage.setItem('lastVideoId', id);
      }
    } catch {
      // ignore
    }
    router.push('/');
  };

  const hasQuery = query.trim().length > 0;

  return (
    <div className="min-h-screen bg-black text-white">
      <div className="max-w-5xl mx-auto pt-4 px-3 pb-8">
        {/* Top bar: back + search */}
        <div className="flex items-center gap-3 mb-3">
          <button
            type="button"
            onClick={handleBack}
            className="flex items-center justify-center w-9 h-9 rounded-full bg-neutral-900 hover:bg-neutral-800 border border-white/10"
          >
            <FaArrowLeft className="text-sm" />
          </button>
          <SearchBar
            initialQuery={initialQuery}
            onSearchCommitted={commitSearchToUrl}
          />
        </div>

        {/* Centered toggles */}
        <div className="flex justify-center mt-2">
          <div className="inline-flex items-center gap-2 rounded-full bg-neutral-900 border border-white/10 px-1.5 py-1">
            {(['media', 'providers', 'users'] as TabKey[]).map((tab) => {
              const active = activeTab === tab;
              return (
                <button
                  key={tab}
                  type="button"
                  onClick={() => changeTab(tab)}
                  className={`px-3 py-1 text-xs sm:text-sm rounded-full transition ${
                    active
                      ? 'bg-emerald-500 text-white shadow-sm'
                      : 'bg-transparent text-gray-300 hover:bg-neutral-800'
                  }`}
                >
                  {tab === 'media'
                    ? 'Media'
                    : tab === 'providers'
                    ? 'Service providers'
                    : 'Users'}
                </button>
              );
            })}
          </div>
        </div>

        {/* Clear search pill */}
        {hasQuery && (
          <div className="flex justify-center mt-3">
            <button
              type="button"
              onClick={() => router.push('/')}
              className="px-4 py-1.5 rounded-full border border-white/25 bg-white/5 text-xs sm:text-sm text-gray-200 hover:bg-white/10"
            >
              Clear search & return to feed
            </button>
          </div>
        )}

        {/* Content */}
        <div className="mt-4">
          {activeTab === 'media' && (
            <MediaHitsGrid
              query={query}
              providerIdsForFallback={providerIdsForFallback}
              onSelectMedia={handleSelectMedia}
            />
          )}

          {activeTab === 'providers' && (
            <PeopleList people={filteredProviders} label="providers" />
          )}

          {activeTab === 'users' && (
            <PeopleList people={filteredUsers} label="users" />
          )}
        </div>
      </div>
    </div>
  );
}

/* ----------------------------- Page wrapper ----------------------------- */

export default function SearchPage() {
  return (
    <InstantSearch searchClient={searchClient} indexName={ALGOLIA_INDEX}>
      <SearchInner />
    </InstantSearch>
  );
}