'use client';

import { useState, FormEvent } from 'react';
import { useRouter } from 'next/navigation';

export default function VideoSearch() {
  const [query, setQuery] = useState('');
  const router = useRouter();

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    const q = query.trim();
    if (!q) return;

    // Send user to the main search page, media tab
    router.push(`/search?q=${encodeURIComponent(q)}&tab=media`);
  };

  return (
    <form onSubmit={onSubmit} className="w-full flex items-center gap-2">
      <input
        type="text"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search videos..."
        className="flex-1 rounded-full bg-neutral-900 text-white px-4 py-2 text-sm border border-white/10 focus:outline-none focus:ring-2 focus:ring-emerald-500/70"
      />
      <button
        type="submit"
        className="px-3 py-2 rounded-full bg-emerald-500 text-white text-sm font-medium hover:bg-emerald-600"
      >
        Search
      </button>
    </form>
  );
}