"use client";

import { useState, useEffect } from "react";
import { onAuthStateChanged } from "firebase/auth";
import { auth } from "@/lib/firebase";
import AuthModal from "@/components/AuthModal";
import VideoFeed from "@/components/VideoFeed";
import SplashScreen from "@/components/SplashScreen";
import TutorialChat from "@/components/TutorialChat";
import { useTutorialFlag } from "@/hooks/useTutorialFlag";
import { VISITOR_TUTORIAL_STEPS } from "@/lib/tutorialSteps";
import { motion, AnimatePresence } from "framer-motion";

export default function LandingPage() {
  const [authOpen, setAuthOpen] = useState(false);
  const [user, setUser] = useState<any>(null);
  const [showSplash, setShowSplash] = useState(true);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => {
      setUser(u);
      if (u) setAuthOpen(false);
    });
    return () => unsub();
  }, []);

  // Safety: auto-dismiss splash if callback never fires
  useEffect(() => {
    if (!showSplash) return;
    const t = setTimeout(() => setShowSplash(false), 2500);
    return () => clearTimeout(t);
  }, [showSplash]);

  // 🆕 First-visit tutorial — shown to anyone landing on the feed, signed in
  // or not (localStorage covers signed-out visitors; the flag is also
  // written to their user doc once they do sign in). Auto-opens once the
  // splash finishes so it doesn't compete with that animation.
  const { loading: tutorialLoading, seen: tutorialSeen, markSeen, replayToken } =
    useTutorialFlag("visitor", user?.uid ?? null);
  const [tutorialOpen, setTutorialOpen] = useState(false);

  useEffect(() => {
    if (showSplash || tutorialLoading || tutorialSeen) return;
    setTutorialOpen(true);
  }, [showSplash, tutorialLoading, tutorialSeen]);

  return (
    <main
      className="bg-black text-white min-h-screen relative overflow-hidden"
      style={{
        // Respect bottom safe area for devices with gesture bars / home indicators
        paddingBottom: "env(safe-area-inset-bottom, 0px)",
      }}
    >
      {/* Feed is mounted immediately, but blurred & slightly scaled until splash ends */}
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

      {/* Splash overlay */}
      <AnimatePresence>
        {showSplash && (
          <SplashScreen onFinish={() => setShowSplash(false)} />
        )}
      </AnimatePresence>

      <AuthModal open={authOpen} onClose={() => setAuthOpen(false)} />

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