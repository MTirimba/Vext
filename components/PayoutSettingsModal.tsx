'use client';

import { useState, useEffect } from 'react';
import { auth, db } from '@/lib/firebase';
import { doc, setDoc, getDoc } from 'firebase/firestore';
import { useAuthState } from 'react-firebase-hooks/auth';

interface PayoutSettingsModalProps {
  onClose: () => void;
  onSetupSuccess: () => void;
}

export default function PayoutSettingsModal({
  onClose,
  onSetupSuccess,
}: PayoutSettingsModalProps) {
  const [user] = useAuthState(auth);

  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [existingPin, setExistingPin] = useState<boolean>(false);
  const [newPin, setNewPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');

  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [initialLoading, setInitialLoading] = useState(true);

  // Load existing payout settings (if any)
  useEffect(() => {
    if (!user) return;

    (async () => {
      try {
        const snap = await getDoc(doc(db, 'users', user.uid));
        if (snap.exists()) {
          const d = snap.data() as any;
          if (d.payout_name) setName(d.payout_name);
          if (d.payout_phone) setPhone(d.payout_phone);
          if (typeof d.withdrawPin === 'string' && d.withdrawPin.trim().length > 0) {
            setExistingPin(true);
          }
        }
      } catch (err) {
        console.error('Error loading payout settings:', err);
        setError('Failed to load payout settings.');
      } finally {
        setInitialLoading(false);
      }
    })();
  }, [user]);

  const handleSave = async () => {
    if (!user) return;
    setError(null);

    if (!name || !phone) {
      setError('Please fill in all fields');
      return;
    }

    // Validate PIN input only if user is trying to set/change it
    if (newPin || confirmPin) {
      if (newPin.length < 4) {
        setError('Withdrawal PIN must be at least 4 digits.');
        return;
      }
      if (!/^\d+$/.test(newPin)) {
        setError('Withdrawal PIN should only contain digits.');
        return;
      }
      if (newPin !== confirmPin) {
        setError('Withdrawal PIN confirmation does not match.');
        return;
      }
    }

    try {
      setLoading(true);

      // Normalize phone number to 254 format for M-Pesa
      let normalizedPhone = phone.trim().replace(/\s+/g, '');
      if (normalizedPhone.startsWith('+')) {
        normalizedPhone = normalizedPhone.slice(1);
      }
      if (normalizedPhone.startsWith('0')) {
        normalizedPhone = '254' + normalizedPhone.substring(1);
      }

      const payload: Record<string, any> = {
        payout_name: name,
        payout_phone: normalizedPhone,
        payout_method: 'mpesa', // ✅ explicitly say it's mpesa
        providerId: user.uid,
      };

      // Only write withdrawPin if user actually provided a new one
      if (newPin && newPin === confirmPin) {
        payload.withdrawPin = newPin;
      }

      // Save payout settings in Firestore (merge with existing user data)
      await setDoc(doc(db, 'users', user.uid), payload, { merge: true });

      setLoading(false);
      onSetupSuccess();
    } catch (err) {
      console.error('Error saving payout settings:', err);
      setError('Failed to save payout settings. Please try again.');
      setLoading(false);
    }
  };

  if (!user) {
    return (
      <div className="fixed inset-0 bg-black bg-opacity-40 flex items-center justify-center">
        <div className="bg-white p-6 rounded shadow w-96">
          <h2 className="text-lg font-semibold mb-4">Setup Payout</h2>
          <p className="text-sm text-gray-600 mb-4">
            You must be signed in to manage payout settings.
          </p>
          <button
            onClick={onClose}
            className="w-full py-2 bg-gray-800 text-white rounded"
          >
            Close
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 bg-black bg-opacity-40 flex items-center justify-center z-50">
      <div className="bg-white p-6 rounded shadow w-96">
        <h2 className="text-lg font-semibold mb-4">Setup Payout</h2>

        {initialLoading ? (
          <p className="text-sm text-gray-600">Loading payout settings…</p>
        ) : (
          <>
            {error && <p className="text-red-600 text-sm mb-2">{error}</p>}

            {/* Payout name */}
            <input
              type="text"
              placeholder="Full Name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full border p-2 mb-3 rounded"
            />

            {/* Payout phone */}
            <input
              type="tel"
              placeholder="Phone Number (e.g. 0700XXXXXX)"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              className="w-full border p-2 mb-4 rounded"
            />

            {/* 🔐 Withdrawal PIN */}
            <div className="border-t pt-3 mt-2 mb-4">
              <p className="text-sm font-medium mb-1">Withdrawal PIN</p>
              {existingPin ? (
                <p className="text-xs text-gray-600 mb-2">
                  You already have a withdrawal PIN set. Enter a new PIN below if you
                  want to change it. The new PIN will replace the existing one.
                </p>
              ) : (
                <p className="text-xs text-gray-600 mb-2">
                  Create a withdrawal PIN to protect your withdrawals. You will be asked
                  for this PIN each time you withdraw funds.
                </p>
              )}

              <input
                type="password"
                placeholder="New PIN (4–6 digits)"
                value={newPin}
                onChange={(e) => setNewPin(e.target.value)}
                maxLength={6}
                className="w-full border p-2 mb-2 rounded text-sm"
              />
              <input
                type="password"
                placeholder="Confirm new PIN"
                value={confirmPin}
                onChange={(e) => setConfirmPin(e.target.value)}
                maxLength={6}
                className="w-full border p-2 mb-1 rounded text-sm"
              />
              <p className="text-[11px] text-gray-500">
                If you forget your PIN, you can set a new one here. For security reasons
                we never show you the existing PIN.
              </p>
            </div>

            <div className="flex justify-end space-x-2">
              <button
                onClick={onClose}
                className="px-4 py-2 bg-gray-300 rounded"
              >
                Cancel
              </button>
              <button
                onClick={handleSave}
                disabled={loading}
                className="px-4 py-2 bg-green-600 text-white rounded hover:bg-green-700 disabled:opacity-50"
              >
                {loading ? 'Saving...' : 'Save'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}