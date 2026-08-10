// /lib/providerBalance.ts
import { adminDb } from './firebaseAdmin';

/**
 * Mirrors providerShare() in app/provider/dashboard/page.tsx exactly,
 * so the server-side balance check always matches what the provider
 * sees on their own dashboard. If you ever change the dashboard's
 * providerShare logic, update this copy too.
 */
function providerShare(b: any): number {
  const explicit = Number(
    b.providerAmount ??
      b.baseTotal ??
      b.subtotalBeforeMarkup ??
      b.subtotal ??
      b.basePrice,
  );
  if (!isNaN(explicit) && explicit > 0) return explicit;

  const total = Number(b.total) || 0;
  if (total <= 0) return 0;

  const feeLikeFields = ['platformFee', 'markupAmount'] as const;
  for (const key of feeLikeFields) {
    const fee = Number(b[key]);
    if (!isNaN(fee) && fee > 0 && fee < total) {
      const implied = total - fee;
      if (implied > 0) return Math.round(implied * 100) / 100;
    }
  }

  if (!isNaN(Number(b.markupRate))) {
    const rate = Number(b.markupRate);
    if (rate > 0 && rate < 1) {
      const implied = total / (1 + rate);
      if (implied > 0) return Math.round(implied * 100) / 100;
    }
  }

  return Math.round(total * 100) / 100;
}

const WITHDRAWN_STATUSES = [
  'completed',
  'success',
  'initiated',
  'pending',
  'processing',
];

/**
 * Available balance = verified earnings − (all initiated/pending/processing/
 * success withdrawals). Same formula as the provider dashboard, computed
 * server-side with the Admin SDK so a client can't just lie about it.
 */
export async function getProviderAvailableBalance(uid: string): Promise<number> {
  const [bookingsSnap, withdrawalsSnap] = await Promise.all([
    adminDb
      .collection('bookings')
      .where('providerId', '==', uid)
      .where('releaseVerified', '==', true)
      .get(),
    adminDb.collection('users').doc(uid).collection('withdrawals').get(),
  ]);

  const totalEarnings = bookingsSnap.docs.reduce(
    (sum, d) => sum + providerShare(d.data()),
    0,
  );

  const totalWithdrawn = withdrawalsSnap.docs.reduce((sum, d) => {
    const data = d.data() as any;
    const status = String(data.status || '').toLowerCase();
    const amount = Number(data.amount) || 0;
    return WITHDRAWN_STATUSES.includes(status) ? sum + amount : sum;
  }, 0);

  return Math.round((totalEarnings - totalWithdrawn) * 100) / 100;
}