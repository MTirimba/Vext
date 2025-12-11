// /workspaces/Vext/components/AuthModal.tsx
'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  GoogleAuthProvider,
  signInWithPopup,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  RecaptchaVerifier,
  signInWithPhoneNumber,
  PhoneAuthProvider,
  linkWithCredential,
} from 'firebase/auth';
import { auth, db } from '@/lib/firebase';
import { createUserProfile } from '@/lib/auth';
import { collection, getDocs, query, where } from 'firebase/firestore';

/* ----------------- Helpers ----------------- */

// Very simple email detector
function looksLikeEmail(value: string): boolean {
  const v = value.trim();
  if (!v) return false;
  return v.includes('@');
}

// Treat anything without @ as "phone-like"
function looksLikePhone(value: string): boolean {
  const v = value.trim();
  if (!v) return false;
  if (v.includes('@')) return false;
  // digits, plus, optional spaces
  return /^[+0-9\s]+$/.test(v);
}

// Normalize Kenyan-style phone numbers to E.164
// Supports: +2547XXXXXXXX, 2547XXXXXXXX, 07XXXXXXXX, 7XXXXXXXX
function normalizePhoneToE164(input: string): string {
  let v = input.trim().replace(/\s+/g, '');
  if (!v) {
    throw new Error('Enter a phone number.');
  }

  // Already E.164
  if (v.startsWith('+')) {
    return v;
  }

  // 2547XXXXXXXX -> +2547XXXXXXXX
  if (/^2547\d{8}$/.test(v)) {
    return `+${v}`;
  }

  // 07XXXXXXXX -> +2547XXXXXXXX
  if (/^07\d{8}$/.test(v)) {
    return `+254${v.slice(1)}`;
  }

  // 7XXXXXXXX -> +2547XXXXXXXX
  if (/^7\d{8}$/.test(v)) {
    return `+254${v}`;
  }

  throw new Error(
    'Enter a valid phone number like 07XXXXXXXX, 7XXXXXXXX or +2547XXXXXXXX.'
  );
}

async function findProfileByPhone(e164: string) {
  const qy = query(collection(db, 'users'), where('phone', '==', e164));
  const snap = await getDocs(qy);
  if (snap.empty) return null;
  const d = snap.docs[0];
  return { id: d.id, ...(d.data() as any) };
}

/* ----------------- Component ----------------- */

export interface AuthModalProps {
  open: boolean;
  onClose: () => void;
}

export default function AuthModal({ open, onClose }: AuthModalProps) {
  const [identifier, setIdentifier] = useState(''); // email OR phone
  const [password, setPassword] = useState('');
  const [isSignUp, setIsSignUp] = useState(false);
  const toggleMode = () => setIsSignUp((v) => !v);

  // Phone OTP state (only used when identifier looks like a phone)
  const [otpSent, setOtpSent] = useState(false);
  const [otpCode, setOtpCode] = useState('');
  const confirmationRef =
    useRef<import('firebase/auth').ConfirmationResult | null>(null);

  // If this phone belongs to a profile with an email,
  // ask for that email's password so we can link.
  const [linkingInfo, setLinkingInfo] = useState<{ email?: string } | null>(
    null,
  );
  const [linkPassword, setLinkPassword] = useState('');
  const [loading, setLoading] = useState(false);

  // UI
  const isEmailLike = useMemo(
    () => looksLikeEmail(identifier),
    [identifier],
  );
  const isPhoneLike = useMemo(
    () => looksLikePhone(identifier),
    [identifier],
  );

  // Disable scroll behind modal
  useEffect(() => {
    document.body.style.overflow = open ? 'hidden' : '';
    return () => {
      document.body.style.overflow = '';
    };
  }, [open]);

  // Reset phone-OTP-specific state when identifier changes
  useEffect(() => {
    setOtpSent(false);
    setOtpCode('');
    setLinkingInfo(null);
  }, [identifier]);

  /* ---------- Google Sign-in ---------- */

  const handleGoogle = async () => {
    try {
      const provider = new GoogleAuthProvider();
      const result = await signInWithPopup(auth, provider);
      await createUserProfile(result.user);
      onClose();
    } catch (err: any) {
      alert(err.message || 'Google sign-in failed');
    }
  };

  /* ---------- Email / Password flow ---------- */

  const handleEmailSubmit = async () => {
    try {
      const email = identifier.trim();
      if (!email || !looksLikeEmail(email)) {
        alert('Enter a valid email address.');
        return;
      }
      if (!password) {
        alert('Enter your password.');
        return;
      }

      setLoading(true);

      const cred = isSignUp
        ? await createUserWithEmailAndPassword(auth, email, password)
        : await signInWithEmailAndPassword(auth, email, password);

      await createUserProfile(cred.user);
      onClose();
    } catch (err: any) {
      alert(err.message || 'Authentication failed.');
    } finally {
      setLoading(false);
    }
  };

  /* ---------- Phone + OTP flow ---------- */

  // create (or reuse) invisible reCAPTCHA
  const ensureRecaptcha = async () => {
    if ((window as any).reCaptchaVerifier) {
      return (window as any).reCaptchaVerifier as RecaptchaVerifier;
    }
    const verifier = new RecaptchaVerifier(auth, 'recaptcha-container', {
      size: 'invisible',
    });
    (window as any).reCaptchaVerifier = verifier;
    return verifier;
  };

  const sendOtp = async () => {
    try {
      const raw = identifier.trim();
      if (!looksLikePhone(raw)) {
        alert('Enter a valid phone number.');
        return;
      }

      setLoading(true);
      const e164 = normalizePhoneToE164(raw);

      const verifier = await ensureRecaptcha();
      const confirmation = await signInWithPhoneNumber(auth, e164, verifier);
      confirmationRef.current = confirmation;
      setOtpSent(true);

      // Check if that phone already maps to an existing profile with email
      const prof = await findProfileByPhone(e164);
      if (prof?.email) {
        setLinkingInfo({ email: prof.email });
      } else {
        setLinkingInfo(null);
      }
    } catch (err: any) {
      console.error('[AUTH_MODAL] sendOtp error:', err);
      alert(err.message || 'Failed to send code. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const confirmOtp = async () => {
    try {
      if (!confirmationRef.current) {
        alert('Please request a code first.');
        return;
      }
      if (!otpCode.trim()) {
        alert('Enter the code you received.');
        return;
      }

      setLoading(true);

      const raw = identifier.trim();
      const e164 = normalizePhoneToE164(raw);

      const phoneCred = PhoneAuthProvider.credential(
        confirmationRef.current.verificationId,
        otpCode.trim(),
      );

      // If phone belongs to an email-based profile, sign in with that email
      // and then link the phone credential.
      if (linkingInfo?.email) {
        if (!linkPassword) {
          setLoading(false);
          alert('Enter the password for ' + linkingInfo.email);
          return;
        }

        const emailUser = await signInWithEmailAndPassword(
          auth,
          linkingInfo.email,
          linkPassword,
        );
        await linkWithCredential(emailUser.user, phoneCred);
        await createUserProfile(emailUser.user);
        onClose();
        return;
      }

      // Normal phone-only sign-in (creates account if needed)
      const result = await confirmationRef.current.confirm(otpCode.trim());
      await createUserProfile(result.user);
      onClose();
    } catch (err: any) {
      console.error('[AUTH_MODAL] confirmOtp error:', err);
      alert(err.message || 'Verification failed. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  /* ---------- Render ---------- */

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

        {/* Logo */}
        <div className="mb-5">
          <img
            src="/vextup-logo.png"
            alt="VEXTUP"
            className="h-20 mx-auto object-contain"
          />
        </div>

        {/* Google */}
        <button
          onClick={handleGoogle}
          className="w-full py-2 rounded-md text-white font-medium transition hover:brightness-95 bg-gradient-to-r from-emerald-800 via-emerald-700 to-green-700 mb-4"
        >
          Continue with Google
        </button>

        <div className="text-gray-400 text-xs uppercase tracking-wide mb-4">
          or use your email / phone
        </div>

        {/* Identifier (email OR phone) */}
        <div className="space-y-3 text-left">
          <input
            className="w-full px-3 py-2 border rounded-md text-gray-800 bg-white"
            placeholder="Email or phone number"
            value={identifier}
            onChange={(e) => setIdentifier(e.target.value)}
          />

          {/* -------- EMAIL MODE -------- */}
          {isEmailLike && (
            <>
              <input
                className="w-full px-3 py-2 border rounded-md text-gray-800 bg-white"
                placeholder="Password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />

              <button
                onClick={handleEmailSubmit}
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
            </>
          )}

          {/* -------- PHONE MODE (OTP) -------- */}
          {isPhoneLike && (
            <>
              {!otpSent ? (
                <>
                  <button
                    onClick={sendOtp}
                    disabled={loading}
                    className="w-full py-2 rounded-md text-white font-medium hover:opacity-95 disabled:opacity-60 bg-gradient-to-r from-emerald-700 via-emerald-600 to-green-600"
                  >
                    {loading ? 'Sending code…' : 'Send code'}
                  </button>
                  <p className="text-xs text-gray-500 text-center">
                    We’ll send a 6-digit code via SMS to verify it’s you.
                  </p>
                </>
              ) : (
                <>
                  <input
                    className="w-full px-3 py-2 border rounded-md text-gray-800 bg-white"
                    placeholder="Enter 6-digit code"
                    value={otpCode}
                    onChange={(e) => setOtpCode(e.target.value)}
                  />

                  {/* If phone belongs to an existing email account, ask for that password to link */}
                  {linkingInfo?.email && (
                    <div className="space-y-1">
                      <div className="text-sm">
                        This number matches an existing account:{' '}
                        <b>{linkingInfo.email}</b>
                      </div>
                      <input
                        className="w-full px-3 py-2 border rounded-md text-gray-800 bg-white"
                        placeholder="Password for existing account"
                        type="password"
                        value={linkPassword}
                        onChange={(e) => setLinkPassword(e.target.value)}
                      />
                    </div>
                  )}

                  <button
                    onClick={confirmOtp}
                    disabled={loading}
                    className="w-full py-2 rounded-md text-white font-medium hover:opacity-95 disabled:opacity-60 bg-gradient-to-r from-emerald-700 via-emerald-600 to-green-600"
                  >
                    {loading
                      ? 'Verifying…'
                      : linkingInfo?.email
                      ? 'Verify & Link'
                      : 'Verify & Sign In'}
                  </button>
                </>
              )}

              <p className="text-xs text-gray-500 text-center mt-1">
                You can sign in again later using the same phone number. No email
                is required.
              </p>
            </>
          )}

          {/* If identifier is neither a clear email nor phone, show a small hint */}
          {!isEmailLike && !isPhoneLike && identifier.trim() && (
            <p className="text-[11px] text-red-500">
              Enter a valid email (e.g. name@example.com) or phone number (e.g.
              07XXXXXXXX or +2547XXXXXXXX).
            </p>
          )}

          {/* 🔄 Global email sign-in/sign-up toggle – always visible */}
          <p className="text-sm text-center mt-2">
            {isSignUp ? 'Already have an account?' : "Don’t have an account?"}{' '}
            <button
              onClick={toggleMode}
              className="text-emerald-700 hover:underline"
              type="button"
            >
              {isSignUp ? 'Sign in' : 'Sign up'}
            </button>
          </p>

          {/* Invisible reCAPTCHA anchor for phone sign-in */}
          <div id="recaptcha-container" />
        </div>
      </div>
    </div>
  );
}