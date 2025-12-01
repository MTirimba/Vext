// app/video/[id]/page.tsx
"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { db } from "@/lib/firebase";
import { doc, getDoc } from "firebase/firestore";

interface VideoDoc {
  id: string;
  videoUrl: string;
  caption?: string;
  createdAt?: any;
}

export default function VideoPage() {
  const { id } = useParams();
  const [video, setVideo] = useState<VideoDoc | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!id) return;

    const fetchVideo = async () => {
      try {
        const docRef = doc(db, "videos", id as string); // use Firestore ID directly
        const docSnap = await getDoc(docRef);

        if (docSnap.exists()) {
          setVideo({ id: docSnap.id, ...docSnap.data() } as VideoDoc);
        } else {
          setVideo(null);
        }
      } catch (error) {
        console.error("Error fetching video:", error);
        setVideo(null);
      } finally {
        setLoading(false);
      }
    };

    fetchVideo();
  }, [id]);

  if (loading) {
    return <p className="p-4">Loading video...</p>;
  }

  if (!video) {
    return <p className="p-4">❌ Video not found.</p>;
  }

  return (
    <div className="flex flex-col items-center p-4">
      <video
        src={video.videoUrl}
        controls
        className="w-full max-w-2xl rounded-lg shadow-md"
      />
      {video.caption && (
        <p className="mt-2 text-lg text-gray-800">{video.caption}</p>
      )}
    </div>
  );
}