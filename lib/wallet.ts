// lib/wallet.ts
import { doc, updateDoc, increment } from 'firebase/firestore';
import { db } from './firebase';

/**
 * Credit provider's pending earnings + lifetime.
 * `providerAmount` should already be the provider's share (base price),
 * NOT the client total.
 */
export async function creditPendingEarnings(
  uid: string,
  providerAmount: number,
) {
  const amt = Math.round(providerAmount * 100) / 100;
  await updateDoc(doc(db, 'users', uid), {
    'wallet.pending': increment(amt),
    'wallet.lifetime': increment(amt),
  });
}

/**
 * Release pending funds to available when service is completed.
 */
export async function releaseEarningsToAvailable(
  uid: string,
  providerAmount: number,
) {
  const amt = Math.round(providerAmount * 100) / 100;
  await updateDoc(doc(db, 'users', uid), {
    'wallet.pending': increment(-amt),
    'wallet.available': increment(amt),
  });
}