'use client';

import { useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

export default function SplashScreen({
  onFinish,
  durationMs = 1400, // animation length
}: {
  onFinish?: () => void;
  durationMs?: number;
}) {
  // Hard stop just in case the animation callback never fires
  useEffect(() => {
    const t = setTimeout(() => onFinish?.(), durationMs + 300);
    return () => clearTimeout(t);
  }, [onFinish, durationMs]);

  return (
    <AnimatePresence>
      <motion.div
        // Fullscreen, but **transparent**. Only the logo is visible.
        className="fixed inset-0 z-[9999] pointer-events-none flex items-center justify-center"
        initial={{ opacity: 1 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
      >
        <motion.img
          src="/vextup-logo.png"
          alt="VEXTUP"
          className="w-[220px] h-auto pointer-events-none"
          initial={{ opacity: 0, scale: 0.84, rotate: -6 }}
          animate={{ opacity: 1, scale: 1, rotate: 0 }}
          transition={{ duration: durationMs / 1000, ease: [0.22, 1, 0.36, 1] }}
          onAnimationComplete={() => onFinish?.()}
        />
      </motion.div>
    </AnimatePresence>
  );
}