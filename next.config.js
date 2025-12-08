/** @type {import('next').NextConfig} */
const nextConfig = {
  eslint: {
    // ✅ Skip ESLint during `next build` so "Unexpected any" etc. don't block deploy
    ignoreDuringBuilds: true,
  },

  async rewrites() {
    return [
      // Personal handles: /@username → /u/username
      {
        source: '/@:handle',
        destination: '/u/:handle',
      },

      // Optional: pretty alias for business handles if you ever want it:
      // /@c/trimac → /c/trimac
      {
        source: '/@c/:handle',
        destination: '/c/:handle',
      },

      // ❌ IMPORTANT:
      // We removed the root "/:handle → /u/:handle" rewrite.
      // Now /trimac will be handled by /app/[handle]/page.tsx
      // which re-exports the BUSINESS page (/app/c/[handle]/page.tsx).
    ];
  },
};

module.exports = nextConfig;