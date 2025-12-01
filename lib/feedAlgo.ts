// /workspaces/Vext/lib/feedAlgo.ts
// Centralized ranking logic for the home feed.
//
// This module ranks a list of video posts using lightweight signals:
// - freshness (time decay)
// - engagement (likes, comments, views if available)
// - social (do I follow this creator?)
// - personalization (creators I’ve liked/commented/watched to the end)
// - diversity (avoid clumping the same creator)
// - tiny random noise to keep the feed feeling alive
//
// You can evolve this over time without touching UI components.

export type MediaItem = { url: string; type?: "image" | "video"; name?: string };

export type VideoDoc = {
  id: string;
  userId?: string | null;
  title?: string;
  description?: string;
  url?: string;

  // carousel
  media?: MediaItem[];
  hasCarousel?: boolean;
  coverUrl?: string;

  // pricing/meta you may already store
  serviceCost?: number;
  createdAt?: number; // epoch ms

  // engagement (if you maintain them on the doc; otherwise pass via opts)
  likeCount?: number;
  commentCount?: number;
  viewCount?: number;
};

export type UserSignals = {
  userId?: string | null;

  // social graph: true if the current user follows this creator
  followsByCreatorId?: Record<string, boolean>;

  // personalization histories (ids)
  likedVideoIds?: Set<string>;
  commentedVideoIds?: Set<string>;
  longWatchedVideoIds?: Set<string>;

  // boost creators I interacted with before
  creatorAffinity?: Record<string, number>;
};

export type AlgoOptions = {
  // A more recent post should outrank an old one. Half-life controls decay.
  // With 24h half-life, items lose ~50% of freshness weight every day.
  freshnessHalfLifeHours?: number;

  // Relative weights for the score components
  weights?: Partial<{
    freshness: number;
    engagement: number;
    social: number;
    personalization: number;
    diversityPenalty: number; // applied later when arranging
    noise: number;
  }>;

  // If you don’t store engagement on the doc, you can provide fallback maps here
  engagementFallbacks?: {
    likeCountByVideoId?: Record<string, number>;
    commentCountByVideoId?: Record<string, number>;
    viewCountByVideoId?: Record<string, number>;
  };

  // Keep at most this many items per creator close together
  maxClusterPerCreator?: number;
};

type Scored<T> = T & { __score: number };

// ---------- helpers ----------

const DEFAULT_WEIGHTS = {
  freshness: 0.50,
  engagement: 0.25,
  social: 0.15,
  personalization: 0.08,
  noise: 0.02,
  diversityPenalty: 0.15, // applied during de-clumping
};

function getEngagement(
  v: VideoDoc,
  fb?: AlgoOptions["engagementFallbacks"]
) {
  const likeCount =
    v.likeCount ??
    fb?.likeCountByVideoId?.[v.id] ??
    0;

  const commentCount =
    v.commentCount ??
    fb?.commentCountByVideoId?.[v.id] ??
    0;

  const viewCount =
    v.viewCount ??
    fb?.viewCountByVideoId?.[v.id] ??
    0;

  return { likeCount, commentCount, viewCount };
}

function freshnessScore(createdAt?: number, halfLifeHours = 24) {
  if (!createdAt) return 0;
  const ageHours = (Date.now() - createdAt) / 36e5;
  // exponential decay: score = 2^(-t/halfLife)
  return Math.pow(2, -ageHours / halfLifeHours);
}

function normalize(x: number, max: number) {
  if (max <= 0) return 0;
  return Math.min(1, x / max);
}

function tinyNoise() {
  // ~[-0.5%, +0.5%] range
  return (Math.random() - 0.5) * 0.01;
}

// ---------- core ranking ----------

export function rankVideos(
  videos: VideoDoc[],
  signals: UserSignals = {},
  options: AlgoOptions = {}
): VideoDoc[] {
  const weights = { ...DEFAULT_WEIGHTS, ...(options.weights || {}) };
  const halfLife = options.freshnessHalfLifeHours ?? 24;

  // Prepare max for normalization of engagement
  let maxLikes = 1, maxComments = 1, maxViews = 1;
  for (const v of videos) {
    const e = getEngagement(v, options.engagementFallbacks);
    if (e.likeCount > maxLikes) maxLikes = e.likeCount;
    if (e.commentCount > maxComments) maxComments = e.commentCount;
    if (e.viewCount > maxViews) maxViews = e.viewCount;
  }

  const scored: Scored<VideoDoc>[] = videos.map((v) => {
    const e = getEngagement(v, options.engagementFallbacks);

    const sFresh = freshnessScore(v.createdAt, halfLife);

    const sEngage =
      0.6 * normalize(e.likeCount, maxLikes) +
      0.3 * normalize(e.commentCount, maxComments) +
      0.1 * normalize(e.viewCount, maxViews);

    const sSocial =
      signals.followsByCreatorId?.[v.userId || ""] ? 1 : 0;

    const personalBoost =
      (signals.likedVideoIds?.has(v.id) ? 0.6 : 0) +
      (signals.commentedVideoIds?.has(v.id) ? 0.3 : 0) +
      (signals.longWatchedVideoIds?.has(v.id) ? 0.4 : 0) +
      (signals.creatorAffinity?.[v.userId || ""] ?? 0);

    const sPersonal = Math.min(1, personalBoost);

    const sNoise = tinyNoise();

    const score =
      weights.freshness * sFresh +
      weights.engagement * sEngage +
      weights.social * sSocial +
      weights.personalization * sPersonal +
      weights.noise * sNoise;

    return { ...v, __score: score };
  });

  // Primary sort by score
  scored.sort((a, b) => b.__score - a.__score);

  // Light de-clumping: spread out same-creator posts
  const maxCluster = options.maxClusterPerCreator ?? 2;
  const out: VideoDoc[] = [];
  const lastSeenIdxByCreator: Record<string, number[]> = {};

  for (const item of scored) {
    const creator = item.userId || "_unknown";
    if (!lastSeenIdxByCreator[creator]) lastSeenIdxByCreator[creator] = [];

    // If creator already appears in the last N slots, try to insert a bit later
    const recentSlots = lastSeenIdxByCreator[creator].filter(
      (idx) => out.length - idx <= maxCluster - 1
    );

    if (recentSlots.length >= maxCluster - 1) {
      // push a little later to diversify (simple heuristic)
      // find first index from end where creator is not over-represented
      let inserted = false;
      for (let i = out.length - 1; i >= 0; i--) {
        const c = (out[i] as any).userId || "_unknown";
        const clusterTail = out.slice(Math.max(0, i - (maxCluster - 2)), i + 1);
        const sameInTail = clusterTail.filter((x) => (x as any).userId === creator).length;
        if (sameInTail < maxCluster - 1) {
          out.splice(i + 1, 0, stripScore(item));
          lastSeenIdxByCreator[creator].push(i + 1);
          inserted = true;
          break;
        }
      }
      if (!inserted) {
        out.push(stripScore(item));
        lastSeenIdxByCreator[creator].push(out.length - 1);
      }
    } else {
      out.push(stripScore(item));
      lastSeenIdxByCreator[creator].push(out.length - 1);
    }
  }

  return out;
}

function stripScore<T extends { __score?: number }>(obj: T): Omit<T, "__score"> {
  const { __score, ...rest } = obj;
  return rest;
}

// ---------- convenience: build signals from localStorage or maps ----------

export function signalsFromLocalStorage(): UserSignals {
  try {
    const liked = new Set<string>(JSON.parse(localStorage.getItem("vext_liked_videos") || "[]"));
    const commented = new Set<string>(JSON.parse(localStorage.getItem("vext_commented_videos") || "[]"));
    const longWatched = new Set<string>(JSON.parse(localStorage.getItem("vext_long_watched") || "[]"));
    const creatorAffinity = JSON.parse(localStorage.getItem("vext_creator_affinity") || "{}") as Record<string, number>;

    return {
      likedVideoIds: liked,
      commentedVideoIds: commented,
      longWatchedVideoIds: longWatched,
      creatorAffinity,
    };
  } catch {
    return {};
  }
}