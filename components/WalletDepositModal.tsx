// /workspaces/Vext/components/WalletDepositModal.tsx
'use client';

import { useEffect, useState } from 'react';
import { useAuthState } from 'react-firebase-hooks/auth';
import PhoneInput from 'react-phone-number-input';
import 'react-phone-number-input/style.css';

import { auth } from '@/lib/firebase';

type PaymentMethod = 'paystack' | 'mpesa' | '';

interface WalletDepositModalProps {
  onClose: () => void;
}

/**
 * Normalize Kenyan Safaricom M-Pesa numbers to 2547XXXXXXXX.
 * Accepts:
 *  - 07XXXXXXXX
 *  - 7XXXXXXXX
 *  - 2547XXXXXXXX
 *  - +2547XXXXXXXX
 */
function normalizeKeMpesaPhone(raw: string) {
  let p = (raw || '').trim();
  if (!p) {
    throw new Error('Enter the M-Pesa phone number');
  }

  // remove spaces
  p = p.replace(/\s+/g, '');

  // strip leading +
  if (p.startsWith('+')) {
    p = p.slice(1);
  }

  // keep only digits
  p = p.replace(/[^\d]/g, '');

  // 07XXXXXXXX (10 digits)
  if (/^07\d{8}$/.test(p)) {
    return '254' + p.slice(1); // 07 -> 2547
  }

  // 7XXXXXXXX (9 digits)
  if (/^7\d{8}$/.test(p)) {
    return '254' + p; // 7 -> 2547
  }

  // 2547XXXXXXXX (12 digits)
  if (/^2547\d{8}$/.test(p)) {
    return p;
  }

  throw new Error(
    'Enter a valid Safaricom number like 07XXXXXXXX, 7XXXXXXXX, 2547XXXXXXXX or +2547XXXXXXXX',
  );
}

export default function WalletDepositModal({
  onClose,
}: WalletDepositModalProps) {
  const [user] = useAuthState(auth);

  const [amount, setAmount] = useState<string>('');
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('');
  const [mpesaPhone, setMpesaPhone] = useState('');
  const [loading, setLoading] = useState(false);
  const [mpesaPending, setMpesaPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  // Prefill phone from Firebase auth if available
  useEffect(() => {
    if (!user?.phoneNumber) return;
    setMpesaPhone(user.phoneNumber);
  }, [user]);

  if (!user) {
    return (
      <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
        <div className="bg-white rounded-lg p-6 max-w-md w-full">
          <h2 className="text-lg font-semibold mb-4">Deposit to Wallet</h2>
          <p className="text-sm text-gray-600 mb-4">
            You must be signed in to deposit funds into your wallet.
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

  const ensurePaystackReady = () =>
    new Promise<void>((resolve, reject) => {
      if ((window as any).PaystackPop?.setup) return resolve();

      const s = document.createElement('script');
      s.src = 'https://js.paystack.co/v1/inline.js';
      s.async = true;
      s.onload = () => {
        const check = setInterval(() => {
          if ((window as any).PaystackPop?.setup) {
            clearInterval(check);
            resolve();
          }
        }, 150);
      };
      s.onerror = () => reject(new Error('Failed to load Paystack'));
      document.body.appendChild(s);
    });

  const handleDeposit = async () => {
    setError(null);
    setInfo(null);

    const amt = Number(amount);
    if (!amt || amt <= 0) {
      setError('Please enter a valid amount.');
      return;
    }
    if (!paymentMethod) {
      setError('Please select a payment method.');
      return;
    }

    try {
      setLoading(true);

      if (paymentMethod === 'paystack') {
        await ensurePaystackReady();

        // Step 1: init Paystack on backend
        const initRes = await fetch('/api/paystack/init', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            email: user.email || 'noemail@vextup.com',
            amount: amt,
            metadata: {
              kind: 'wallet_deposit',
              userId: user.uid,
            },
          }),
        });

        const initData = await initRes.json();
        if (!initRes.ok || !initData?.reference) {
          throw new Error(initData?.error || 'Failed to start card payment.');
        }

        const PaystackLib = (window as any).PaystackPop;

        const handler = PaystackLib.setup({
          key: process.env.NEXT_PUBLIC_PAYSTACK_KEY!,
          email: user.email || 'noemail@vextup.com',
          amount: Math.round(amt * 100),
          currency: 'KES',
          ref: initData.reference,
          metadata: { kind: 'wallet_deposit', userId: user.uid },
          callback(response: any) {
            (async () => {
              try {
                // Ask backend to verify with Paystack & credit wallet
                const verifyRes = await fetch('/api/paystack/verify', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    reference: response.reference,
                    walletDeposit: true,
                  }),
                });

                const verifyData = await verifyRes.json().catch(() => null);
                if (!verifyRes.ok) {
                  console.error('Paystack verify error:', verifyData);
                  alert(
                    'Payment succeeded, but we could not verify it automatically. Please check your wallet later.',
                  );
                } else {
                  alert(
                    'Deposit successful. Your wallet balance will update shortly.',
                  );
                }
                onClose();
              } catch (err) {
                console.error('Paystack verify error:', err);
                alert(
                  'Payment processed, but we could not verify it automatically. Please check your wallet later.',
                );
                onClose();
              }
            })();
          },
          onClose: () => {
            // User closed without paying
          },
        });

        handler.openIframe();
      }

      if (paymentMethod === 'mpesa') {
        if (!mpesaPhone.trim()) {
          setError('Please enter the M-Pesa number to charge.');
          setLoading(false);
          return;
        }
        const msisdn = normalizeKeMpesaPhone(mpesaPhone);
        setMpesaPending(true);

        const mpesaRes = await fetch('/api/mpesa/init', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            phoneNumber: msisdn,
            amount: amt,
            walletDeposit: true,
            userId: user.uid,
            description: 'Wallet deposit to VextUp',
          }),
        });

        if (!mpesaRes.ok) {
          const text = await mpesaRes.text().catch(() => '');
          throw new Error(
            text || 'Failed to start M-Pesa payment. Please try again.',
          );
        }

        setInfo(
          'STK push sent to your phone. Approve the payment and your wallet will update automatically once confirmed.',
        );
      }
    } catch (err: any) {
      console.error('Wallet deposit error:', err);
      setError(err?.message || 'Something went wrong. Please try again.');
    } finally {
      setLoading(false);
      if (paymentMethod === 'mpesa') {
        setMpesaPending(false);
      }
    }
  };

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg p-6 max-w-md w-full shadow-xl">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold">Deposit to Wallet</h2>
          <button
            type="button"
            onClick={onClose}
            className="text-gray-500 hover:text-gray-700 text-sm"
          >
            ✕
          </button>
        </div>

        <div className="space-y-4">
          {/* Amount */}
          <div>
            <label className="block text-sm font-medium mb-1">
              Amount to deposit
            </label>
            <input
              type="number"
              min={0}
              step="0.01"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className="w-full border rounded px-3 py-2 text-sm"
            />
          </div>

          {/* Payment method */}
          <div>
            <label className="block text-sm font-medium mb-1">
              Payment method
            </label>
            <select
              className="w-full border rounded px-3 py-2 text-sm"
              value={paymentMethod}
              onChange={(e) =>
                setPaymentMethod(e.target.value as PaymentMethod)
              }
              disabled={mpesaPending || loading}
            >
              <option value="">-- choose --</option>
              <option value="paystack">Card (Paystack)</option>
              <option value="mpesa">M-Pesa STK Push</option>
            </select>
          </div>

          {paymentMethod === 'mpesa' && (
            <div>
              <label className="block text-sm font-medium mb-1">
                M-Pesa number to charge
              </label>
              <PhoneInput
                international
                defaultCountry="KE"
                value={mpesaPhone}
                onChange={(v) => setMpesaPhone(v || '')}
                className="border rounded px-2 py-[3px] text-sm"
              />
              <p className="mt-1 text-[11px] text-gray-500">
                You can enter 07XXXXXXXX, 7XXXXXXXX, 2547XXXXXXXX or
                +2547XXXXXXXX. We&apos;ll format it automatically.
              </p>
            </div>
          )}

          {error && (
            <div className="text-xs text-red-600 bg-red-50 border border-red-200 rounded px-2 py-1">
              {error}
            </div>
          )}
          {info && (
            <div className="text-xs text-emerald-700 bg-emerald-50 border border-emerald-200 rounded px-2 py-1">
              {info}
            </div>
          )}

          <button
            type="button"
            onClick={handleDeposit}
            disabled={loading || mpesaPending}
            className="w-full py-2 bg-emerald-600 text-white rounded hover:bg-emerald-700 disabled:opacity-60 disabled:cursor-not-allowed"
          >
            {loading ? 'Processing…' : 'Confirm Deposit'}
          </button>
        </div>
      </div>
    </div>
  );
}