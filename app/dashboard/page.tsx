"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { onAuthStateChanged } from "firebase/auth";
import { auth } from "@/lib/firebase";
import VideoFeed from "@/components/VideoFeed";
import SplashScreen from "@/components/SplashScreen";
import TutorialChat from "@/components/TutorialChat";
import { useTutorialFlag } from "@/hooks/useTutorialFlag";
import { VISITOR_TUTORIAL_STEPS } from "@/lib/tutorialSteps";
import { motion, AnimatePresence } from "framer-motion";

export default function DashboardPage() {
  const router = useRouter();
  const [showSplash, setShowSplash] = useState(true);
  const [uid, setUid] = useState<string | null>(null);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (user) => {
      if (!user) router.push("/");
      else setUid(user.uid);
    });
    return () => unsub();
  }, [router]);

  useEffect(() => {
    if (!showSplash) return;
    const t = setTimeout(() => setShowSplash(false), 2500);
    return () => clearTimeout(t);
  }, [showSplash]);

  // Same visitor tutorial as the signed-out landing page — someone could
  // hit /dashboard as their first ever screen (e.g. a bookmarked link)
  // without having seen it there first.
  const { loading: tutorialLoading, seen: tutorialSeen, markSeen, replayToken } =
    useTutorialFlag("visitor", uid);
  const [tutorialOpen, setTutorialOpen] = useState(false);

  useEffect(() => {
    if (showSplash || tutorialLoading || tutorialSeen) return;
    setTutorialOpen(true);
  }, [showSplash, tutorialLoading, tutorialSeen]);

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

      <TutorialChat
        steps={VISITOR_TUTORIAL_STEPS}
        open={tutorialOpen}
        resetKey={replayToken}
        onFinish={() => {
          setTutorialOpen(false);
          markSeen();
        }}
      />
    </main>
  );
}