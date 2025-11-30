'use client';

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  // Keep layout minimal so the page-level tabs are the only nav
  return (
    <div className="p-6 max-w-7xl mx-auto">
      <h1 className="text-2xl font-bold mb-4">Admin</h1>
      {children}
    </div>
  );
}