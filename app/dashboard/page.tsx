"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { onAuthStateChanged } from "firebase/auth";
import { auth } from "@/lib/firebase";
import VideoFeed from "@/components/VideoFeed";
import SplashScreen from "@/components/SplashScreen";
import { motion, AnimatePresence } from "framer-motion";

export default function DashboardPage() {
  const router = useRouter();
  const [showSplash, setShowSplash] = useState(true);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (user) => {
      if (!user) router.push("/");
    });
    return () => unsub();
  }, [router]);

  useEffect(() => {
    if (!showSplash) return;
    const t = setTimeout(() => setShowSplash(false), 2500);
    return () => clearTimeout(t);
  }, [showSplash]);

  return (
    <main
      className="bg-black text-white min-h-screen relative overflow-hidden"
      style={{
        paddingBottom: "env(safe-area-inset-bottom, 0px)",
      }}
    >
      <motion.div
        className="relative z-10"
        initial={{ opacity: 0.3, scale: 1.015, filter: "blur(10px)" }}
        animate={
          showSplash
            ? { opacity: 0.3, scale: 1.015, filter: "blur(10px)" }
            : { opacity: 1, scale: 1, filter: "blur(0px)" }
        }
        transition={{ duration: 0.45, ease: [0.2, 0.8, 0.2, 1] }}
      >
        <VideoFeed />
      </motion.div>

      <AnimatePresence>
        {showSplash && (
          <SplashScreen onFinish={() => setShowSplash(false)} />
        )}
      </AnimatePresence>
    </main>
  );
}