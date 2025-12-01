'use client';

import { useState } from 'react';
import { auth } from '@/lib/firebase';

export default function GrantAdminPage() {
  const [msg, setMsg] = useState<string>('');

  const grant = async () => {
    try {
      const u = auth.currentUser;
      if (!u) return setMsg('Please sign in first.');
      const token = await u.getIdToken(true);

      const res = await fetch('/api/admin/bootstrap', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ /* optional: targetUid: 'ANOTHER_USER_UID' */ }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed');

      // refresh claims so the client sees isAdmin immediately
      await u.getIdToken(true);
      setMsg(`✅ Granted admin to ${data.uid}`);
    } catch (e: any) {
      setMsg(`❌ ${e.message}`);
    }
  };

  return (
    <div className="p-6 max-w-lg mx-auto">
      <h1 className="text-xl font-bold mb-3">Admin Bootstrap</h1>
      <p className="text-sm text-gray-600 mb-4">
        You must be signed in as the owner (UID in <code>ADMIN_OWNER_UID</code>).
      </p>
      <button onClick={grant} className="px-4 py-2 rounded bg-black text-white hover:opacity-90">
        Grant me admin
      </button>
      {msg && <p className="mt-3 text-sm">{msg}</p>}
    </div>
  );
}