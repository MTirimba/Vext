// app/video/[id]/page.tsx
import type { Metadata } from "next";

type PageProps = {
  params: { id: string };
};

type VideoDoc = {
  id: string;
  url: string;
  title?: string;
  description?: string;
  thumbnailUrl?: string;
};

/* ---------- Firestore REST helper (server-side) ---------- */

const FIREBASE_PROJECT_ID = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
const FIREBASE_API_KEY = process.env.NEXT_PUBLIC_FIREBASE_API_KEY;

// Parse Firestore REST "fields" object into a simple VideoDoc
function parseVideoDoc(id: string, data: any): VideoDoc | null {
  const f = data?.fields;
  if (!f) return null;

  const getString = (field: string): string | undefined =>
    f[field]?.stringValue ?? undefined;

  return {
    id,
    url: getString("url") || "",
    title: getString("title"),
    description: getString("description"),
    thumbnailUrl:
      getString("thumbnailUrl") ||
      getString("coverUrl") || // backwards compat
      getString("url") || undefined,
  };
}

async function fetchVideoById(id: string): Promise<VideoDoc | null> {
  if (!FIREBASE_PROJECT_ID || !FIREBASE_API_KEY) {
    console.error(
      "Missing NEXT_PUBLIC_FIREBASE_PROJECT_ID or NEXT_PUBLIC_FIREBASE_API_KEY env vars."
    );
    return null;
  }

  const res = await fetch(
    `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/databases/(default)/documents/videos/${encodeURIComponent(
      id
    )}?key=${FIREBASE_API_KEY}`,
    {
      // don’t cache so updates show up in previews reasonably quickly
      cache: "no-store",
    }
  );

  if (!res.ok) {
    console.error("Failed to fetch video doc:", res.status, await res.text());
    return null;
  }

  const json = await res.json();
  return parseVideoDoc(id, json);
}

/* ---------- Open Graph / Twitter metadata ---------- */

export async function generateMetadata(
  { params }: PageProps
): Promise<Metadata> {
  const video = await fetchVideoById(params.id);

  if (!video) {
    return {
      title: "Service not found | VextUp",
      description: "This service could not be found on VextUp.",
    };
  }

  const baseUrl = "https://vextup.com";
  const url = `${baseUrl}/video/${params.id}`;

  const title = video.title || "Service on VextUp";
  const description =
    video.description ||
    "Book this service on VextUp – see details, pricing and reserve a slot instantly.";

  const ogImage = video.thumbnailUrl || "/og-default.png";

  return {
    title: `${title} | VextUp`,
    description,
    openGraph: {
      type: "website",
      url,
      title: `${title} | VextUp`,
      description,
      images: [
        {
          url: ogImage,
          width: 1200,
          height: 630,
        },
      ],
    },
    twitter: {
      card: "summary_large_image",
      title: `${title} | VextUp`,
      description,
      images: [ogImage],
    },
  };
}

/* ---------- Page UI (server component) ---------- */

export default async function VideoPage({ params }: PageProps) {
  const video = await fetchVideoById(params.id);

  if (!video || !video.url) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-black text-white">
        <p>❌ Video not found.</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-black flex flex-col items-center justify-center p-4">
      <video
        src={video.url}
        controls
        playsInline
        className="w-full max-w-2xl rounded-lg shadow-xl bg-black"
      />
      {(video.title || video.description) && (
        <div className="mt-4 text-center max-w-2xl">
          {video.title && (
            <h1 className="text-xl font-semibold text-white mb-1">
              {video.title}
            </h1>
          )}
          {video.description && (
            <p className="text-sm text-gray-300">{video.description}</p>
          )}
        </div>
      )}
    </div>
  );
}