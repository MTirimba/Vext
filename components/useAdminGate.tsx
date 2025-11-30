'use client';
import { useEffect, useState } from 'react';
import { auth } from '@/lib/firebase';
import { onAuthStateChanged, getIdTokenResult } from 'firebase/auth';

export function useAdminGate() {
  const [status, setStatus] = useState<'loading'|'forbidden'|'ok'|'signedout'>('loading');

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (u) => {
      if (!u) return setStatus('signedout');
      try {
        const tok = await getIdTokenResult(u, true);
        setStatus(tok.claims?.isAdmin ? 'ok' : 'forbidden');
      } catch {
        setStatus('forbidden');
      }
    });
    return () => unsub();
  }, []);

  return status;
}