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

// Phone input (same one used in Profile)
import PhoneInput from 'react-phone-number-input';
import 'react-phone-number-input/style.css';

export interface AuthModalProps {
  open: boolean;
  onClose: () => void;
}

/* ----------------- Helpers ----------------- */

function normalizeE164(phone: string | undefined): string {
  const v = (phone || '').trim();
  // PhoneInput returns E.164 like +2547XXXXXXX when valid.
  if (!v || !v.startsWith('+')) {
    throw new Error('Enter a valid phone number (include country).');
  }
  return v;
}

async function findProfileByPhone(e164: string) {
  const qy = query(collection(db, 'users'), where('phone', '==', e164));
  const snap = await getDocs(qy);
  if (snap.empty) return null;
  const d = snap.docs[0];
  return { id: d.id, ...(d.data() as any) };
}

/* ----------------- Component ----------------- */

export default function AuthModal({ open, onClose }: AuthModalProps) {
  const [tab, setTab] = useState<'email' | 'phone'>('email');

  // Shared
  useEffect(() => {
    document.body.style.overflow = open ? 'hidden' : '';
    return () => {
      document.body.style.overflow = '';
    };
  }, [open]);

  // ---------- Email/Password ----------
  const [emailOrPhoneForEmailFlow, setEmailOrPhoneForEmailFlow] = useState('');
  const [password, setPassword] = useState('');
  const [isSignUp, setIsSignUp] = useState(false);
  const toggleMode = () => setIsSignUp(v => !v);

  // ---------- Google ----------
  const handleGoogle = async () => {
    try {
      const provider = new GoogleAuthProvider();
      const result = await signInWithPopup(auth, provider);
      await createUserProfile(result.user);
      onClose();
    } catch (err: any) {
      alert(err.message);
    }
  };

  // Email/Password submit
  const handleSubmitEmail = async () => {
    try {
      const email = emailOrPhoneForEmailFlow.trim();
      if (!email) return alert('Enter your email');
      if (!password) return alert('Enter your password');

      const cred = isSignUp
        ? await createUserWithEmailAndPassword(auth, email, password)
        : await signInWithEmailAndPassword(auth, email, password);

      await createUserProfile(cred.user);
      onClose();
    } catch (err: any) {
      alert(err.message);
    }
  };

  // ---------- Phone (OTP) ----------
  const [phoneValue, setPhoneValue] = useState<string>(''); // E.164 string from PhoneInput
  const [otpSent, setOtpSent] = useState(false);
  const [otpCode, setOtpCode] = useState('');
  const confirmationRef = useRef<import('firebase/auth').ConfirmationResult | null>(null);

  // If we detect this phone is on an existing profile with an email,
  // we’ll ask for that email password to LINK after OTP.
  const [linkingInfo, setLinkingInfo] = useState<{ email?: string } | null>(null);
  const [linkPassword, setLinkPassword] = useState('');
  const [loading, setLoading] = useState(false);

  // Create (or reuse) invisible reCAPTCHA
  const ensureRecaptcha = async () => {
    if ((window as any).reCaptchaVerifier) return (window as any).reCaptchaVerifier as RecaptchaVerifier;
    const verifier = new RecaptchaVerifier(auth, 'recaptcha-container', { size: 'invisible' });
    (window as any).reCaptchaVerifier = verifier;
    return verifier;
  };

  const sendOtp = async () => {
    try {
      setLoading(true);
      const e164 = normalizeE164(phoneValue);

      const verifier = await ensureRecaptcha();
      const confirmation = await signInWithPhoneNumber(auth, e164, verifier);
      confirmationRef.current = confirmation;
      setOtpSent(true);

      // Peek: if that phone belongs to a profile with email, we’ll show link UI after OTP.
      const prof = await findProfileByPhone(e164);
      if (prof?.email) {
        setLinkingInfo({ email: prof.email });
      } else {
        setLinkingInfo(null);
      }
    } catch (err: any) {
      alert(err.message || 'Failed to send code');
    } finally {
      setLoading(false);
    }
  };

  const confirmOtp = async () => {
    try {
      if (!confirmationRef.current) return;
      if (!otpCode.trim()) return alert('Enter the code');

      setLoading(true);
      const phoneE164 = normalizeE164(phoneValue);

      // Build credential from OTP (without changing auth state yet)
      const phoneCred = PhoneAuthProvider.credential(
        confirmationRef.current.verificationId,
        otpCode.trim()
      );

      // If this phone maps to an existing profile that has email,
      // sign in with that email + password, THEN link the phone.
      if (linkingInfo?.email) {
        if (!linkPassword) {
          setLoading(false);
          return alert('Enter password for ' + linkingInfo.email);
        }
        const emailUser = await signInWithEmailAndPassword(auth, linkingInfo.email, linkPassword);
        await linkWithCredential(emailUser.user, phoneCred);
        await createUserProfile(emailUser.user);
        onClose();
        return;
      }

      // Otherwise, normal phone sign-in (creates/uses phone user)
      const result = await confirmationRef.current.confirm(otpCode.trim());
      await createUserProfile(result.user);
      onClose();
    } catch (err: any) {
      alert(err.message || 'Verification failed');
    } finally {
      setLoading(false);
    }
  };

  // UI helpers
  const phoneTabDisabled = useMemo(() => loading, [loading]);

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
            className="h-20 mx-auto object-contain" /* larger logo */
          />
        </div>

        {/* Tabs */}
        <div className="flex justify-center gap-2 mb-5">
          <button
            onClick={() => setTab('email')}
            className={`px-3.5 py-1.5 rounded-full text-sm font-medium transition ${
              tab === 'email'
                ? 'text-white bg-gradient-to-r from-emerald-700 via-emerald-600 to-green-600 shadow-sm'
                : 'bg-gray-200 text-gray-800 hover:bg-gray-300'
            }`}
          >
            Email / Password
          </button>
          <button
            onClick={() => setTab('phone')}
            className={`px-3.5 py-1.5 rounded-full text-sm font-medium transition ${
              tab === 'phone'
                ? 'text-white bg-gradient-to-r from-emerald-700 via-emerald-600 to-green-600 shadow-sm'
                : 'bg-gray-200 text-gray-800 hover:bg-gray-300'
            } ${phoneTabDisabled ? 'opacity-70 cursor-not-allowed' : ''}`}
            disabled={phoneTabDisabled}
          >
            Phone (OTP)
          </button>
        </div>

        {/* -------- EMAIL TAB -------- */}
        {tab === 'email' && (
          <div className="space-y-3">
            <button
              onClick={handleGoogle}
              className="w-full py-2 rounded-md text-white font-medium transition hover:brightness-95 bg-gradient-to-r from-emerald-800 via-emerald-700 to-green-700"
            >
              Continue with Google
            </button>

            <div className="text-gray-400 text-xs uppercase tracking-wide">or use email</div>

            <input
              className="w-full px-3 py-2 border rounded-md text-gray-800 bg-white"
              placeholder="Email"
              type="email"
              value={emailOrPhoneForEmailFlow}
              onChange={e => setEmailOrPhoneForEmailFlow(e.target.value)}
            />
            <input
              className="w-full px-3 py-2 border rounded-md text-gray-800 bg-white"
              placeholder="Password"
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
            />

            <button
              onClick={handleSubmitEmail}
              className="w-full py-2 rounded-md text-white font-medium hover:opacity-95 bg-gradient-to-r from-emerald-700 via-emerald-600 to-green-600"
            >
              {isSignUp ? 'Create Account' : 'Sign In'}
            </button>

            <p className="text-sm">
              {isSignUp ? 'Already have an account?' : "Don't have an account?"}{' '}
              <button
                onClick={toggleMode}
                className="text-emerald-700 hover:underline"
              >
                {isSignUp ? 'Sign in' : 'Sign up'}
              </button>
            </p>
          </div>
        )}

        {/* -------- PHONE TAB -------- */}
        {tab === 'phone' && (
          <div className="space-y-3 text-left">
            {/* Country picker + phone (same component as Profile) */}
            <PhoneInput
              international
              defaultCountry="KE"
              placeholder="Enter phone number"
              value={phoneValue}
              onChange={setPhoneValue as any}
              className="w-full text-left"
            />

            {!otpSent ? (
              <>
                <button
                  onClick={sendOtp}
                  disabled={loading}
                  className="w-full py-2 rounded-md text-white font-medium hover:opacity-95 disabled:opacity-60 bg-gradient-to-r from-emerald-700 via-emerald-600 to-green-600"
                >
                  {loading ? 'Sending…' : 'Send Code'}
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
                  onChange={e => setOtpCode(e.target.value)}
                />

                {/* If phone belongs to an existing email profile, ask for password to link */}
                {linkingInfo?.email && (
                  <div className="space-y-1">
                    <div className="text-sm">
                      This number matches an existing account: <b>{linkingInfo.email}</b>
                    </div>
                    <input
                      className="w-full px-3 py-2 border rounded-md text-gray-800 bg-white"
                      placeholder="Password for existing account"
                      type="password"
                      value={linkPassword}
                      onChange={e => setLinkPassword(e.target.value)}
                    />
                  </div>
                )}

                <button
                  onClick={confirmOtp}
                  disabled={loading}
                  className="w-full py-2 rounded-md text-white font-medium hover:opacity-95 disabled:opacity-60 bg-gradient-to-r from-emerald-700 via-emerald-600 to-green-600"
                >
                  {loading ? 'Verifying…' : linkingInfo?.email ? 'Verify & Link' : 'Verify & Sign In'}
                </button>
              </>
            )}

            {/* Invisible reCAPTCHA anchor */}
            <div id="recaptcha-container" />
          </div>
        )}
      </div>
    </div>
  );
}