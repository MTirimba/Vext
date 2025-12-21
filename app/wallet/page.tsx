// /workspaces/Vext/app/wallet/page.tsx
'use client';

import { useEffect, useState } from 'react';
import { useAuthState } from 'react-firebase-hooks/auth';
import { auth, db } from '@/lib/firebase';
import {
  collection,
  onSnapshot,
  orderBy,
  query,
  doc,
  getDoc,
} from 'firebase/firestore';

import WithdrawModal from '@/components/WithdrawModal';
import WithdrawalHistory from '@/components/WithdrawalHistory';
import WalletDepositModal from '@/components/WalletDepositModal';

type WalletTx = {
  id: string;
  amount: number;
  type: 'credit' | 'debit';
  reason?: string;
  bookingId?: string;
  createdAt?: any;
  status?: string;
};

export default function ClientWalletPage() {
  const [user] = useAuthState(auth);
  const [transactions, setTransactions] = useState<WalletTx[]>([]);
  const [balance, setBalance] = useState(0);
  const [loading, setLoading] = useState(true);

  const [showDeposit, setShowDeposit] = useState(false);
  const [showWithdraw, setShowWithdraw] = useState(false);

  // Whether this user is also a service provider
  const [isProvider, setIsProvider] = useState(false);

  // Load user role so we can explain that this wallet is personal-only
  useEffect(() => {
    if (!user) {
      setIsProvider(false);
      return;
    }

    const userRef = doc(db, 'users', user.uid);
    getDoc(userRef)
      .then((snap) => {
        if (!snap.exists()) {
          setIsProvider(false);
          return;
        }
        const data = snap.data() as any;
        // Support both legacy and new flags
        const providerFlag = !!(data.isProvider || data.isServiceProvider);
        setIsProvider(providerFlag);
      })
      .catch(() => {
        setIsProvider(false);
      });
  }, [user]);

  useEffect(() => {
    if (!user) return;

    const txRef = collection(db, 'users', user.uid, 'walletTransactions');
    const q = query(txRef, orderBy('createdAt', 'desc'));

    const unsub = onSnapshot(q, (snap) => {
      const txs: WalletTx[] = snap.docs.map((d) => ({
        id: d.id,
        ...(d.data() as any),
      }));

      setTransactions(txs);

      // Compute balance using completed transactions only
      const rawBalance = txs.reduce((sum, tx) => {
        if ((tx.status || '').toLowerCase() !== 'completed') return sum;
        const amt = Number(tx.amount) || 0;
        return sum + (tx.type === 'credit' ? amt : -amt);
      }, 0);

      // ✅ Personal wallet should never be negative. If we ever
      // see a negative number here (e.g. provider business payout
      // accidentally recorded as a wallet debit), clamp it to zero
      // so personal and business funds stay visually separated.
      const safeBalance = rawBalance < 0 ? 0 : rawBalance;

      setBalance(safeBalance);
      setLoading(false);
    });

    return () => unsub();
  }, [user]);

  if (!user) {
    return <div className="p-6">Please sign in to view your wallet.</div>;
  }

  if (loading) {
    return <div className="p-6">Loading wallet…</div>;
  }

  const formatReason = (tx: WalletTx) => {
    if (tx.reason === 'provider_rejected_booking') {
      return 'Refund: provider rejected your booking';
    }
    if (tx.reason === 'client_cancelled_booking') {
      return 'Refund: you cancelled a paid booking';
    }
    if (tx.reason === 'provider_cancelled_booking') {
      return 'Refund from provider cancellation';
    }
    if (tx.reason === 'wallet_deposit') {
      return 'Wallet deposit';
    }
    if (tx.reason === 'wallet_withdraw') {
      return 'Wallet withdrawal';
    }
    return tx.reason || 'Wallet transaction';
  };

  return (
    <div className="p-6 max-w-2xl mx-auto">
      <h1 className="text-2xl font-bold mb-4">
        {isProvider ? 'My Personal Wallet' : 'My Wallet'}
      </h1>

      {/* Balance card */}
      <div className="p-5 bg-white shadow rounded mb-6">
        <h2 className="font-semibold text-gray-600">
          Available Wallet Balance
        </h2>
        <p className="text-3xl font-bold text-emerald-700 mt-2">
          KSH {balance.toFixed(2)}
        </p>
        <p className="text-xs text-gray-500 mt-2">
          {isProvider ? (
            <>
              This is your <strong>personal wallet</strong> on VextUp. It holds
              money you deposit here yourself and refunds from bookings you make
              as a client. It is completely{' '}
              <strong>separate from your provider earnings</strong> and
              withdrawals shown in the Provider Dashboard.
            </>
          ) : (
            <>
              Funds appear here when a service provider rejects a paid booking,
              when you cancel an eligible paid booking, or when you deposit
              money into your wallet. You can use this balance to pay for new
              services or withdraw it to M-Pesa.
            </>
          )}
        </p>

        {/* Actions */}
        <div className="mt-4 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setShowDeposit(true)}
            className="px-4 py-2 rounded bg-emerald-600 text-white text-sm hover:bg-emerald-700"
          >
            Deposit Funds
          </button>
          <button
            type="button"
            onClick={() => setShowWithdraw(true)}
            disabled={balance <= 0}
            className="px-4 py-2 rounded bg-gray-800 text-white text-sm hover:bg-gray-900 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Withdraw Funds
          </button>
        </div>
      </div>

      {/* Transactions list (deposits, refunds & wallet debits) */}
      <div className="bg-white shadow rounded">
        <h2 className="px-4 py-3 border-b font-semibold text-gray-700">
          Wallet Activity (deposits, refunds & debits)
        </h2>

        {transactions.length === 0 ? (
          <p className="px-4 py-4 text-sm text-gray-500">
            No wallet activity yet.
          </p>
        ) : (
          <ul className="divide-y">
            {transactions.map((tx) => {
              const date =
                tx.createdAt?.toDate?.() ??
                (tx.createdAt ? new Date(tx.createdAt) : null);

              return (
                <li
                  key={tx.id}
                  className="px-4 py-3 flex items-start justify-between gap-4"
                >
                  <div className="flex-1">
                    <div className="text-sm font-medium text-gray-800">
                      {formatReason(tx)}
                    </div>
                    {tx.bookingId && (
                      <div className="text-xs text-gray-500 mt-0.5">
                        Booking ID: {tx.bookingId}
                      </div>
                    )}
                    {date && (
                      <div className="text-xs text-gray-400 mt-0.5">
                        {date.toLocaleString()}
                      </div>
                    )}
                  </div>
                  <div className="text-right">
                    <div
                      className={
                        'text-sm font-semibold ' +
                        (tx.type === 'credit'
                          ? 'text-emerald-700'
                          : 'text-red-600')
                      }
                    >
                      {tx.type === 'credit' ? '+' : '-'} KSH{' '}
                      {Number(tx.amount || 0).toFixed(2)}
                    </div>
                    {tx.status && (
                      <div className="text-[11px] text-gray-500 mt-0.5">
                        {tx.status}
                      </div>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {/* Separate withdrawal history (M-Pesa payouts) */}
      <div className="mt-6">
        <WithdrawalHistory />
      </div>

      {/* Modals */}
      {showDeposit && (
        <WalletDepositModal onClose={() => setShowDeposit(false)} />
      )}
      {showWithdraw && (
        <WithdrawModal
          available={balance}
          onClose={() => setShowWithdraw(false)}
        />
      )}
    </div>
  );
}