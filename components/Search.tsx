'use client';

import { useRouter } from 'next/navigation';
import { useState, FormEvent } from 'react';

export default function Search() {
  const router = useRouter();
  const [term, setTerm] = useState('');

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    const q = term.trim();
    if (!q) return;

    const params = new URLSearchParams();
    params.set('q', q);
    params.set('tab', 'media'); // default tab

    router.push(`/search?${params.toString()}`);
  };

  return (
    <form
      onSubmit={onSubmit}
      className="w-full max-w-md flex items-center gap-2"
    >
      <input
        value={term}
        onChange={(e) => setTerm(e.target.value)}
        placeholder="Search services, providers, or users…"
        className="flex-1 rounded-full bg-neutral-900 text-white px-4 py-2 text-sm border border-white/10 focus:outline-none focus:ring-2 focus:ring-emerald-500/70"
      />
      <button
        type="submit"
        className="px-4 py-2 rounded-full bg-emerald-500 text-sm font-semibold text-white hover:bg-emerald-600"
      >
        Search
      </button>
    </form>
  );
}