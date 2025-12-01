'use client';

import { useState, useEffect } from 'react';
import { onAuthStateChanged } from 'firebase/auth';
import { auth } from '@/lib/firebase';
import AuthModal from '@/components/AuthModal';
import VideoFeed from '@/components/VideoFeed';
import SplashScreen from '@/components/SplashScreen';
import { motion, AnimatePresence } from 'framer-motion';

export default function LandingPage() {
  const [authOpen, setAuthOpen] = useState(false);
  const [user, setUser] = useState<any>(null);
  const [showSplash, setShowSplash] = useState(true);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, u => {
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

  return (
    <main className="bg-black text-white min-h-screen relative overflow-hidden">
      {/* Feed is mounted immediately, but blurred & slightly scaled until splash ends */}
      <motion.div
        className="relative z-10"
        initial={{ opacity: 0.3, scale: 1.015, filter: 'blur(10px)' }}
        animate={
          showSplash
            ? { opacity: 0.3, scale: 1.015, filter: 'blur(10px)' }
            : { opacity: 1, scale: 1, filter: 'blur(0px)' }
        }
        transition={{ duration: 0.45, ease: [0.2, 0.8, 0.2, 1] }}
      >
        <VideoFeed />
      </motion.div>

      {/* Splash overlay */}
      <AnimatePresence>{showSplash && <SplashScreen onFinish={() => setShowSplash(false)} />}</AnimatePresence>

      <AuthModal open={authOpen} onClose={() => setAuthOpen(false)} />
    </main>
  );
}