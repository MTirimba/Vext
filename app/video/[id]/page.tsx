// app/video/[id]/page.tsx
"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { db } from "@/lib/firebase";
import { doc, getDoc } from "firebase/firestore";

type MediaItem = {
  url: string;
  type: "image" | "video";
};

interface VideoDoc {
  id: string;
  userId?: string;
  url?: string;        // legacy single URL
  coverUrl?: string;   // primary thumbnail
  media?: MediaItem[]; // carousel items
  title?: string;
  description?: string;
  serviceCost?: number;
  timeTaken?: { hours?: number; minutes?: number };
}

/**
 * Choose the primary media to display:
 * 1) First item in media[]
 * 2) coverUrl
 * 3) url
 */
function getPrimaryMedia(video: VideoDoc): MediaItem | null {
  if (video.media && video.media.length > 0) {
    return video.media[0];
  }

  const src = video.coverUrl || video.url;
  if (!src) return null;

  const isImage = /\.(png|jpe?g|gif|webp|avif|bmp)$/i.test(
    src.split("?")[0] || ""
  );

  return {
    url: src,
    type: isImage ? "image" : "video",
  };
}

export default function VideoPage() {
  const params = useParams();
  const router = useRouter();

  // params.id can be string | string[] | undefined depending on Next internals
  const id =
    typeof params?.id === "string"
      ? params.id
      : Array.isArray(params?.id)
      ? params.id[0]
      : undefined;

  const [video, setVideo] = useState<VideoDoc | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!id) {
      setLoading(false);
      return;
    }

    const fetchVideo = async () => {
      try {
        const ref = doc(db, "videos", id);
        const snap = await getDoc(ref);
        if (snap.exists()) {
          const data = snap.data() as any;
          setVideo({ id: snap.id, ...data });
        } else {
          setVideo(null);
        }
      } catch (err) {
        console.error("Error fetching video doc:", err);
        setVideo(null);
      } finally {
        setLoading(false);
      }
    };

    fetchVideo();
  }, [id]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-black text-white">
        <p>Loading video…</p>
      </div>
    );
  }

  if (!video || !id) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-black text-white">
        <p className="mb-4">❌ Video not found.</p>
        <button
          type="button"
          onClick={() => router.push("/")}
          className="px-4 py-2 rounded bg-white text-black text-sm"
        >
          Go home
        </button>
      </div>
    );
  }

  const primary = getPrimaryMedia(video);

  return (
    <div className="min-h-screen bg-black flex flex-col items-center justify-center p-4">
      <div className="w-full max-w-2xl">
        {primary?.type === "image" ? (
          <img
            src={primary.url}
            alt={video.title || "Upload"}
            className="w-full max-h-[70vh] object-contain rounded-lg bg-black"
          />
        ) : (
          <video
            src={primary?.url}
            controls
            autoPlay
            playsInline
            className="w-full max-h-[70vh] object-contain rounded-lg bg-black"
          />
        )}

        {video.title && (
          <h1 className="mt-3 text-lg font-semibold text-white">
            {video.title}
          </h1>
        )}

        {video.description && (
          <p className="mt-1 text-sm text-gray-300 whitespace-pre-line">
            {video.description}
          </p>
        )}
      </div>
    </div>
  );
}