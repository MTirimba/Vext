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
  sendPasswordResetEmail,
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
    'Enter a valid phone number.'
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
  const [confirmPassword, setConfirmPassword] = useState('');
  const [isSignUp, setIsSignUp] = useState(false);
  const toggleMode = () => {
    setIsSignUp((v) => !v);
    setConfirmPassword('');
    setError(null);
    setSuccess(null);
  };

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

  // Inline banners
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

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

  // Reset phone-OTP-specific state + banners when identifier changes
  useEffect(() => {
    setOtpSent(false);
    setOtpCode('');
    setLinkingInfo(null);
    setError(null);
    setSuccess(null);
  }, [identifier]);

  /* ---------- Google Sign-in ---------- */

  const handleGoogle = async () => {
    try {
      setError(null);
      setSuccess(null);

      const provider = new GoogleAuthProvider();
      const result = await signInWithPopup(auth, provider);
      await createUserProfile(result.user);
      onClose();
    } catch (err: any) {
      console.error('[AUTH_MODAL] Google sign-in error:', err);
      let msg =
        err?.message || 'Google sign-in failed. Please try again or use email/phone.';
      if (err?.code === 'auth/popup-closed-by-user') {
        msg =
          'Google sign-in was cancelled. You can try again or sign in with email or phone.';
      }
      setError(msg);
    }
  };

  /* ---------- Email / Password flow ---------- */

  const handleEmailSubmit = async () => {
    try {
      setError(null);
      setSuccess(null);

      const email = identifier.trim();
      if (!email || !looksLikeEmail(email)) {
        setError('Enter a valid email address.');
        return;
      }
      if (!password) {
        setError('Enter your password.');
        return;
      }

      if (isSignUp) {
        if (!confirmPassword) {
          setError('Please confirm your password.');
          return;
        }
        if (password !== confirmPassword) {
          setError('Passwords do not match.');
          return;
        }
      }

      setLoading(true);

      const cred = isSignUp
        ? await createUserWithEmailAndPassword(auth, email, password)
        : await signInWithEmailAndPassword(auth, email, password);

      await createUserProfile(cred.user);
      onClose();
    } catch (err: any) {
      console.error('[AUTH_MODAL] email auth error:', err);
      if (err?.code === 'auth/email-already-in-use') {
        setError(
          'An account with this email already exists. Please sign in instead.'
        );
        setIsSignUp(false);
      } else if (err?.code === 'auth/wrong-password') {
        setError('Incorrect password. Please try again.');
      } else if (err?.code === 'auth/user-not-found') {
        setError('No account found with this email. Try signing up instead.');
      } else {
        setError(err.message || 'Authentication failed.');
      }
    } finally {
      setLoading(false);
    }
  };

  const handleForgotPassword = async () => {
    const email = identifier.trim();
    setError(null);
    setSuccess(null);

    if (!looksLikeEmail(email)) {
      setError('Enter your email above, then click "Forgot password?".');
      return;
    }

    try {
      setLoading(true);
      await sendPasswordResetEmail(auth, email);
      setSuccess('Password reset email sent. Please check your inbox.');
    } catch (err: any) {
      console.error('[AUTH_MODAL] password reset error:', err);
      setError(err.message || 'Failed to send password reset email.');
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
      setError(null);
      setSuccess(null);

      const raw = identifier.trim();
      if (!looksLikePhone(raw)) {
        setError('Enter a valid phone number.');
        return;
      }

      // For sign-up, enforce password + confirm
      if (isSignUp) {
        if (!password) {
          setError('Create a password first.');
          return;
        }
        if (!confirmPassword) {
          setError('Please confirm your password.');
          return;
        }
        if (password !== confirmPassword) {
          setError('Passwords do not match.');
          return;
        }
      }

      setLoading(true);
      const e164 = normalizePhoneToE164(raw);

      // If user is trying to sign up with a phone that already has a profile, stop them
      const prof = await findProfileByPhone(e164);
      if (isSignUp && prof) {
        setLoading(false);
        setError(
          'An account with this phone number already exists. Please sign in instead.'
        );
        return;
      }

      const verifier = await ensureRecaptcha();
      const confirmation = await signInWithPhoneNumber(auth, e164, verifier);
      confirmationRef.current = confirmation;
      setOtpSent(true);

      // For existing profiles, we may need to link with email
      if (prof?.email) {
        setLinkingInfo({ email: prof.email });
      } else {
        setLinkingInfo(null);
      }
    } catch (err: any) {
      console.error('[AUTH_MODAL] sendOtp error:', err);
      setError(err.message || 'Failed to send code. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const confirmOtp = async () => {
    try {
      setError(null);
      setSuccess(null);

      if (!confirmationRef.current) {
        setError('Please request a code first.');
        return;
      }
      if (!otpCode.trim()) {
        setError('Enter the code you received.');
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
          setError('Enter the password for ' + linkingInfo.email);
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
      setError(err.message || 'Verification failed. Please try again.');
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

        {/* Identifier + password(s) */}
        <div className="space-y-3 text-left">
          <input
            className="w-full px-3 py-2 border rounded-md text-gray-800 bg-white"
            placeholder="Email or phone number"
            value={identifier}
            onChange={(e) => setIdentifier(e.target.value)}
          />

          {/* Password (always visible) */}
          <input
            className="w-full px-3 py-2 border rounded-md text-gray-800 bg-white"
            placeholder="Password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />

          {/* Confirm password (sign up only) */}
          {isSignUp && (
            <input
              className="w-full px-3 py-2 border rounded-md text-gray-800 bg-white"
              placeholder="Confirm password"
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
            />
          )}

          {/* -------- EMAIL MODE -------- */}
          {isEmailLike && (
            <>
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

              {!isSignUp && (
                <div className="flex justify-end">
                  <button
                    type="button"
                    onClick={handleForgotPassword}
                    className="text-xs text-emerald-700 hover:underline"
                  >
                    Forgot password?
                  </button>
                </div>
              )}
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
                      : isSignUp
                      ? 'Verify & Sign Up'
                      : 'Verify & Sign In'}
                  </button>
                </>
              )}
            </>
          )}

          {/* If identifier is neither a clear email nor phone, show a small hint */}
          {!isEmailLike && !isPhoneLike && identifier.trim() && (
            <p className="text-[11px] text-red-500">
              Enter a valid email (e.g. name@example.com) or phone number (e.g.
              07XXXXXXXX or +2547XXXXXXXX).
            </p>
          )}

          {/* Inline banners */}
          {error && (
            <div className="text-xs text-red-600 bg-red-50 border border-red-200 rounded px-2 py-1 mt-1">
              {error}
            </div>
          )}
          {success && (
            <div className="text-xs text-emerald-700 bg-emerald-50 border border-emerald-200 rounded px-2 py-1 mt-1">
              {success}
            </div>
          )}

          {/* 🔄 Global email/phone sign-in/sign-up toggle – always visible */}
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