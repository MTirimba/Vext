// /workspaces/Vext/components/WithdrawModal.tsx
'use client';

import { useState, useEffect, FormEvent } from 'react';
import PhoneInput from 'react-phone-number-input';
import 'react-phone-number-input/style.css';

import { auth, db } from '@/lib/firebase';
import { useAuthState } from 'react-firebase-hooks/auth';
import {
  addDoc,
  collection,
  serverTimestamp,
  doc,
  getDoc,
  updateDoc,
} from 'firebase/firestore';

interface WithdrawModalProps {
  available: number;
  onClose: () => void;
}

// Normalize whatever is stored in Firestore to a valid E.164 string if possible
function normalizeToE164(raw?: string | null): string {
  if (!raw) return '';
  let v = raw.trim();

  // Already looks like +2547xxxx
  if (v.startsWith('+')) return v;

  // 2547xxxxxx -> +2547xxxxxx
  if (/^2547\d{8}$/.test(v)) return `+${v}`;

  // 07xxxxxxxx -> +2547xxxxxxxx
  if (/^07\d{8}$/.test(v)) return `+254${v.slice(1)}`;

  // 7xxxxxxxx -> +2547xxxxxxxx
  if (/^7\d{8}$/.test(v)) return `+254${v}`;

  return v;
}

export default function WithdrawModal({ available, onClose }: WithdrawModalProps) {
  const [user] = useAuthState(auth);

  const [amount, setAmount] = useState<string>('');
  const [phoneNumber, setPhoneNumber] = useState<string>(''); // E.164
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // 🔐 Withdrawal PIN state
  const [storedWithdrawPin, setStoredWithdrawPin] = useState<string | null>(null);
  const [pinInput, setPinInput] = useState<string>('');
  const [pinVerified, setPinVerified] = useState<boolean>(false);
  const [pinError, setPinError] = useState<string | null>(null);

  // Prefill phone from user's payout settings & load withdrawal PIN if present
  useEffect(() => {
    if (!user) return;

    (async () => {
      try {
        console.log('[WITHDRAW_MODAL] Loading user payout profile for', user.uid);
        const snap = await getDoc(doc(db, 'users', user.uid));
        if (snap.exists()) {
          const d = snap.data() as any;
          const raw = d.payout_phone || d.phone;
          const normalized = normalizeToE164(raw);
          console.log('[WITHDRAW_MODAL] Loaded payout data:', {
            rawPhone: raw,
            normalizedPhone: normalized,
          });
          if (normalized) setPhoneNumber(normalized);

          // 🔐 existing PIN on profile (plain for now)
          if (typeof d.withdrawPin === 'string' && d.withdrawPin.trim().length > 0) {
            console.log('[WITHDRAW_MODAL] Existing withdrawPin found on profile');
            setStoredWithdrawPin(d.withdrawPin.trim());
          } else {
            console.log('[WITHDRAW_MODAL] No withdrawPin set on profile');
            setStoredWithdrawPin(null);
          }
        } else {
          console.warn('[WITHDRAW_MODAL] No user document found for', user.uid);
        }
      } catch (err) {
        console.error('Failed to load payout phone / withdraw PIN:', err);
      }
    })();
  }, [user]);

  if (!user) {
    return (
      <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
        <div className="bg-white rounded-lg p-6 max-w-md w-full">
          <h2 className="text-lg font-semibold mb-4">Withdraw Funds</h2>
          <p className="text-sm text-gray-600 mb-4">
            You must be signed in to withdraw funds.
          </p>
          <button
            onClick={onClose}
            className="w-full py-2 rounded bg-gray-800 text-white"
          >
            Close
          </button>
        </div>
      </div>
    );
  }

  const handleMax = () => {
    setAmount(available.toFixed(2));
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccess(null);

    const amountNumber = Number(amount);
    if (!amountNumber || amountNumber <= 0) {
      setError('Please enter a valid amount.');
      return;
    }
    if (amountNumber > available) {
      setError('Amount exceeds your available balance.');
      return;
    }
    if (!phoneNumber) {
      setError('Please enter a valid M-Pesa number.');
      return;
    }

    try {
      setSubmitting(true);

      console.log('[WITHDRAW_MODAL] Creating withdrawal document', {
        userId: user.uid,
        amountNumber,
        phoneNumber,
      });

      // 1) Create withdrawal doc under the user (client is allowed by rules)
      const withdrawalsRef = collection(db, 'users', user.uid, 'withdrawals');
      const withdrawalDocRef = await addDoc(withdrawalsRef, {
        amount: amountNumber,
        phoneNumber,
        status: 'initiated',
        createdAt: serverTimestamp(),
        channel: 'mpesa-b2c',
      });

      console.log('[WITHDRAW_MODAL] Withdrawal doc created:', {
        path: withdrawalDocRef.path,
        id: withdrawalDocRef.id,
      });

      // 2) Call our B2C API, passing userId + withdrawalId
      const resp = await fetch('/api/mpesa/b2c', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          amount: amountNumber,
          phoneNumber, // E.164; route will normalize to 2547xxxx
          userId: user.uid,
          withdrawalId: withdrawalDocRef.id,
        }),
      });

      let data: any = null;
      try {
        data = await resp.json();
      } catch (jsonErr) {
        console.error(
          '[WITHDRAW_MODAL] Failed to parse JSON from /api/mpesa/b2c:',
          jsonErr,
        );
      }

      console.log('[WITHDRAW_MODAL] /api/mpesa/b2c response:', {
        ok: resp.ok,
        status: resp.status,
        data,
      });

      if (!resp.ok) {
        console.error('[WITHDRAW_MODAL] B2C error full response:', data);

        // mark this withdrawal as failed on init error
        try {
          await updateDoc(withdrawalDocRef, {
            status: 'failed',
            mpesaInitError: data || null,
          });
        } catch (updateErr) {
          console.error(
            '[WITHDRAW_MODAL] Failed to mark withdrawal as failed:',
            updateErr,
          );
        }

        setError(
          (data && data.error) ||
            'Withdrawal failed. Please check your details and try again.',
        );
        setSubmitting(false);
        return;
      }

      // all good on init, actual success/failure will come via B2C callback
      setSuccess(
        'Withdrawal request sent. You will receive an M-Pesa SMS once it is processed.',
      );
      setSubmitting(false);

      // small delay so user can see success then close
      setTimeout(() => {
        onClose();
      }, 1500);
    } catch (err: any) {
      console.error('Withdrawal submit error:', err);
      setError(err?.message || 'Something went wrong. Please try again.');
      setSubmitting(false);
    }
  };

  const isCreatingPin = !storedWithdrawPin;
  const pinGateEnabled = true; // always require some PIN step: create or verify

  // 🔐 Create a new withdrawal PIN (first time / reset via settings)
  const handleCreatePin = async () => {
    setPinError(null);
    const input = pinInput.trim();

    if (input.length < 4) {
      setPinError('Choose a PIN of at least 4 digits.');
      return;
    }
    if (!/^\d+$/.test(input)) {
      setPinError('PIN should contain digits only.');
      return;
    }

    try {
      console.log('[WITHDRAW_MODAL] Saving new withdrawPin for user', user.uid);
      await updateDoc(doc(db, 'users', user.uid), {
        withdrawPin: input,
      });
      setStoredWithdrawPin(input);
      setPinVerified(true);
      setPinInput('');
    } catch (e) {
      console.error('Failed to save withdraw PIN:', e);
      setPinError('Could not save PIN. Please try again.');
    }
  };

  // 🔐 Verify existing withdrawal PIN
  const handleVerifyPin = () => {
    setPinError(null);
    const input = pinInput.trim();

    if (!input) {
      setPinError('Please enter your withdrawal PIN.');
      return;
    }

    if (!storedWithdrawPin) {
      console.warn(
        '[WITHDRAW_MODAL] No storedWithdrawPin found, allowing PIN verification by default',
      );
      setPinVerified(true);
      return;
    }

    if (input !== storedWithdrawPin) {
      console.warn('[WITHDRAW_MODAL] Incorrect withdrawal PIN entered');
      setPinError('Incorrect PIN. Please try again.');
      return;
    }

    console.log('[WITHDRAW_MODAL] Withdrawal PIN verified');
    setPinVerified(true);
    setPinInput('');
  };

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg p-6 max-w-md w-full shadow-xl">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold">Withdraw Funds</h2>
          <button
            type="button"
            onClick={onClose}
            className="text-gray-500 hover:text-gray-700 text-sm"
          >
            ✕
          </button>
        </div>

        <p className="text-sm text-gray-600 mb-4">
          Available balance{' '}
          <span className="font-semibold text-emerald-700">
            KSH {available.toFixed(2)}
          </span>
        </p>

        {/* 🔐 Step 1: Withdrawal PIN (create or verify) */}
        {pinGateEnabled && !pinVerified && (
          <div className="space-y-3">
            <div>
              <label className="block text-sm font-medium mb-1">
                {isCreatingPin ? 'Create a withdrawal PIN' : 'Withdrawal PIN'}
              </label>
              <input
                type="password"
                value={pinInput}
                onChange={(e) => setPinInput(e.target.value)}
                maxLength={6}
                className="w-full border rounded px-3 py-2 text-sm"
                placeholder={
                  isCreatingPin
                    ? 'Choose a 4–6 digit PIN'
                    : 'Enter your withdrawal PIN'
                }
              />
              <p className="mt-1 text-[11px] text-gray-500">
                This PIN protects your withdrawals. Keep it private and do not
                share it with anyone. If you forget it, you can set a new one in
                your payout settings.
              </p>
            </div>
            {pinError && (
              <div className="text-xs text-red-600 bg-red-50 border border-red-200 rounded px-2 py-1">
                {pinError}
              </div>
            )}
            <button
              type="button"
              onClick={isCreatingPin ? handleCreatePin : handleVerifyPin}
              className="w-full py-2 bg-emerald-600 text-white rounded hover:bg-emerald-700 mt-1"
            >
              {isCreatingPin ? 'Save PIN & Continue' : 'Continue'}
            </button>
          </div>
        )}

        {/* Step 2: Actual withdrawal form (only visible when PIN verified) */}
        {pinVerified && (
          <form onSubmit={handleSubmit} className="space-y-4 mt-4">
            {/* Amount */}
            <div>
              <label className="block text-sm font-medium mb-1">
                Amount to withdraw
              </label>
              <div className="flex gap-2">
                <input
                  type="number"
                  min={0}
                  step="0.01"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  className="flex-1 border rounded px-3 py-2 text-sm"
                />
                <button
                  type="button"
                  onClick={handleMax}
                  className="px-3 py-2 text-sm border rounded bg-gray-100 hover:bg-gray-200"
                >
                  Max
                </button>
              </div>
            </div>

            {/* Phone input */}
            <div>
              <label className="block text-sm font-medium mb-1">
                Withdraw to M-Pesa number
              </label>
              <PhoneInput
                international
                defaultCountry="KE"
                value={phoneNumber}
                onChange={(v) => setPhoneNumber(v || '')}
                className="border rounded px-2 py-[3px] text-sm"
              />
              <p className="mt-1 text-[11px] text-gray-500">
                Use the format with country code, e.g. <code>+2547XXXXXXXX</code>.
              </p>
            </div>

            {/* Error / success */}
            {error && (
              <div className="text-xs text-red-600 bg-red-50 border border-red-200 rounded px-2 py-1">
                {error}
              </div>
            )}
            {success && (
              <div className="text-xs text-emerald-700 bg-emerald-50 border border-emerald-200 rounded px-2 py-1">
                {success}
              </div>
            )}

            <button
              type="submit"
              disabled={submitting}
              className="w-full py-2 bg-emerald-600 text-white rounded hover:bg-emerald-700 disabled:opacity-60 disabled:cursor-not-allowed mt-2"
            >
              {submitting ? 'Processing…' : 'Confirm Withdrawal'}
            </button>
          </form>
        )}

        {/* Guvoel Digital footer */}
        <p className="mt-6 text-[10px] text-gray-400 text-center">
          Guvoel Digital © 2025
        </p>
      </div>
    </div>
  );
}