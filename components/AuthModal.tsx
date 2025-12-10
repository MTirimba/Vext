// /workspaces/Vext/components/AuthModal.tsx
'use client';

import { useEffect, useState } from 'react';
import {
  GoogleAuthProvider,
  signInWithPopup,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
} from 'firebase/auth';
import { auth, db } from '@/lib/firebase';
import { createUserProfile } from '@/lib/auth';
import { collection, getDocs, query, where } from 'firebase/firestore';

export interface AuthModalProps {
  open: boolean;
  onClose: () => void;
}

/* ----------------- Helpers ----------------- */

// Very light E.164 normalizer for KE-style numbers so users can type
// 07xxxxxxxx, 7xxxxxxxx, 2547xxxxxxxx or +2547xxxxxxxx.
function normalizeE164(phone: string | undefined): string {
  let v = (phone || '').trim();
  if (!v) throw new Error('Enter a valid phone number.');

  // Already E.164
  if (v.startsWith('+')) return v;

  // Strip spaces
  v = v.replace(/\s+/g, '');

  // 2547xxxxxxxx -> +2547xxxxxxxx
  if (/^2547\d{8}$/.test(v)) return `+${v}`;

  // 07xxxxxxxx -> +2547xxxxxxxx
  if (/^07\d{8}$/.test(v)) return `+254${v.slice(1)}`;

  // 7xxxxxxxx -> +2547xxxxxxxx
  if (/^7\d{8}$/.test(v)) return `+254${v}`;

  // Fallback – treat as already international
  if (/^\d{8,15}$/.test(v)) return `+${v}`;

  throw new Error('Enter a valid phone number (e.g. +2547XXXXXXXX).');
}

async function findProfileByPhone(e164: string) {
  const qy = query(collection(db, 'users'), where('phone', '==', e164));
  const snap = await getDocs(qy);
  if (snap.empty) return null;
  const d = snap.docs[0];
  return { id: d.id, ...(d.data() as any) };
}

function looksLikeEmail(value: string): boolean {
  return value.includes('@');
}

/* ----------------- Component ----------------- */

export default function AuthModal({ open, onClose }: AuthModalProps) {
  // single Instagram-style form
  const [identifier, setIdentifier] = useState(''); // email or phone
  const [password, setPassword] = useState('');
  const [isSignUp, setIsSignUp] = useState(false);
  const [loading, setLoading] = useState(false);

  // Lock body scroll when modal open
  useEffect(() => {
    document.body.style.overflow = open ? 'hidden' : '';
    return () => {
      document.body.style.overflow = '';
    };
  }, [open]);

  const toggleMode = () => setIsSignUp((v) => !v);

  // ---------- Google ----------

  const handleGoogle = async () => {
    try {
      setLoading(true);
      const provider = new GoogleAuthProvider();
      const result = await signInWithPopup(auth, provider);
      await createUserProfile(result.user);
      onClose();
    } catch (err: any) {
      alert(err.message || 'Google sign-in failed');
    } finally {
      setLoading(false);
    }
  };

  // ---------- Email / Phone + Password flow ----------

  const handleSubmit = async () => {
    try {
      const rawId = identifier.trim();
      const pwd = password;

      if (!rawId) return alert('Enter your email or phone number.');
      if (!pwd) return alert('Enter your password.');

      setLoading(true);

      let emailToUse = rawId;

      if (looksLikeEmail(rawId)) {
        // Treat as normal email
        emailToUse = rawId;
      } else {
        // Treat as phone for **sign in** – map phone → profile.email
        if (isSignUp) {
          setLoading(false);
          return alert(
            'Please sign up with an email address for now. ' +
              'You can add your phone number in your profile after creating the account.'
          );
        }

        // Sign-in with phone + password
        const e164 = normalizeE164(rawId);
        const prof = await findProfileByPhone(e164);
        if (!prof || !prof.email) {
          setLoading(false);
          return alert(
            'No account found for that phone number. Try using your email, or sign up first.'
          );
        }
        emailToUse = prof.email as string;
      }

      if (isSignUp) {
        // New account – must be a real email
        if (!looksLikeEmail(emailToUse)) {
          setLoading(false);
          return alert(
            'You must sign up with a valid email address (e.g. name@example.com).'
          );
        }

        const cred = await createUserWithEmailAndPassword(
          auth,
          emailToUse,
          pwd
        );
        await createUserProfile(cred.user);
        onClose();
        return;
      }

      // Sign-in
      const cred = await signInWithEmailAndPassword(auth, emailToUse, pwd);
      await createUserProfile(cred.user); // ensures profile doc exists / updated
      onClose();
    } catch (err: any) {
      console.error('[AUTH_MODAL] Auth error:', err);
      alert(err.message || 'Authentication failed. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70">
      <div className="bg-white p-6 rounded-xl w-[420px] max-w-[92vw] text-center shadow-xl relative">
        <button
          onClick={onClose}
          className="absolute top-2 right-3 text-gray-500 hover:text-gray-700 text-xl"
          aria-label="Close"
        >
          ×
        </button>

        {/* Logo — larger */}
        <div className="mb-5">
          <img
            src="/vextup-logo.png"
            alt="VEXTUP"
            className="h-20 mx-auto object-contain"
          />
        </div>

        {/* Title */}
        <h2 className="text-lg font-semibold mb-1">Welcome to VextUp</h2>
        <p className="text-xs text-gray-500 mb-4">
          Sign in with your email or phone number and password.
        </p>

        {/* Google button */}
        <button
          onClick={handleGoogle}
          disabled={loading}
          className="w-full py-2 rounded-md text-white font-medium transition hover:brightness-95 disabled:opacity-60 bg-gradient-to-r from-emerald-800 via-emerald-700 to-green-700 mb-3"
        >
          Continue with Google
        </button>

        <div className="text-gray-400 text-xs uppercase tracking-wide mb-3">
          or
        </div>

        {/* Single Instagram-like form */}
        <div className="space-y-3 text-left">
          <input
            className="w-full px-3 py-2 border rounded-md text-gray-800 bg-white"
            placeholder="Email or phone (e.g. name@example.com or +2547XXXXXXXX)"
            type="text"
            value={identifier}
            onChange={(e) => setIdentifier(e.target.value)}
          />
          <input
            className="w-full px-3 py-2 border rounded-md text-gray-800 bg-white"
            placeholder="Password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />

          <button
            onClick={handleSubmit}
            disabled={loading}
            className="w-full py-2 rounded-md text-white font-medium hover:opacity-95 disabled:opacity-60 bg-gradient-to-r from-emerald-700 via-emerald-600 to-green-600"
          >
            {loading
              ? isSignUp
                ? 'Creating account…'
                : 'Signing in…'
              : isSignUp
              ? 'Create Account'
              : 'Sign In'}
          </button>

          <p className="text-sm text-center">
            {isSignUp ? 'Already have an account?' : "Don't have an account?"}{' '}
            <button
              onClick={toggleMode}
              className="text-emerald-700 hover:underline"
              type="button"
            >
              {isSignUp ? 'Sign in' : 'Sign up'}
            </button>
          </p>
        </div>
      </div>
    </div>
  );
}