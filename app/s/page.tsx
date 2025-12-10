// /workspaces/Vext/app/s/page.tsx
import type { Metadata } from 'next';

type PageProps = {
  searchParams?: {
    id?: string;
    title?: string;
    desc?: string;
    image?: string;
  };
};

// Build OG / Twitter metadata from query string.
export function generateMetadata({ searchParams }: PageProps): Metadata {
  const id = searchParams?.id || '';
  const rawTitle = searchParams?.title || '';
  const rawDesc = searchParams?.desc || '';
  const image = searchParams?.image || '';

  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || 'https://vextup.com';
  const pageUrl = id
    ? `${siteUrl}/s?id=${encodeURIComponent(id)}`
    : `${siteUrl}/s`;

  const title = rawTitle
    ? `${rawTitle} | VextUp`
    : 'Service on VextUp';
  const description =
    rawDesc ||
    'Book this service on VextUp – see details, pricing and reserve a slot instantly.';

  const images = image
    ? [
        {
          url: image,
          width: 1200,
          height: 630,
          alt: rawTitle || 'VextUp service',
        },
      ]
    : undefined;

  return {
    title,
    description,
    openGraph: {
      title,
      description,
      url: pageUrl,
      siteName: 'VextUp',
      type: 'website',
      images,
    },
    twitter: {
      card: 'summary_large_image',
      title,
      description,
      images: images?.[0]?.url,
    },
  };
}

export default function SharePage({ searchParams }: PageProps) {
  const id = searchParams?.id || '';
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || '';
  const targetUrl = id ? `${siteUrl}/video/${id}` : siteUrl || '/';

  return (
    <main className="min-h-screen flex flex-col items-center justify-center bg-black text-white">
      <h1 className="text-xl font-semibold mb-3">
        Opening service on VextUp…
      </h1>
      <p className="mb-4 text-sm text-gray-300">
        If you are not redirected automatically, tap the button below.
      </p>

      <a
        href={targetUrl}
        className="px-4 py-2 rounded-full bg-emerald-500 hover:bg-emerald-600 text-sm font-medium"
      >
        Go to service
      </a>

      {/* Client-side redirect for normal users */}
      <script
        dangerouslySetInnerHTML={{
          __html: `
            if (typeof window !== 'undefined') {
              window.location.href = ${JSON.stringify(targetUrl)};
            }
          `,
        }}
      />
    </main>
  );
}