// /workspaces/Vext/app/s/page.tsx
import type { Metadata } from "next";

type ShareSearchParams = {
  id?: string;
  title?: string;
  desc?: string;
  image?: string;
};

type SearchParamsInput = ShareSearchParams | Promise<ShareSearchParams> | undefined;

// Helper to normalise possible Promise searchParams
async function resolveSearchParams(input: SearchParamsInput): Promise<ShareSearchParams> {
  if (!input) return {};
  if (typeof (input as any).then === "function") {
    // It's a Promise-like
    try {
      return ((await input) || {}) as ShareSearchParams;
    } catch {
      return {};
    }
  }
  return input as ShareSearchParams;
}

// Dynamic metadata so WhatsApp / FB / X etc get a proper OG preview
export async function generateMetadata(
  props: { searchParams?: SearchParamsInput }
): Promise<Metadata> {
  const searchParams = await resolveSearchParams(props.searchParams);
  const { id, title, desc, image } = searchParams;

  const baseUrl = "https://vextup.com";
  const targetUrl = id ? `${baseUrl}/video/${id}` : baseUrl;

  const finalTitle = title ? `${title} | VextUp` : "VextUp service";
  const finalDesc =
    desc ||
    "Book services and pay easily with VextUp – discover trusted providers and reserve instantly.";

  const ogImages =
    image && image.length > 0
      ? [
          {
            url: image,
            width: 1200,
            height: 630,
            alt: title || "VextUp service",
          },
        ]
      : undefined;

  return {
    title: finalTitle,
    description: finalDesc,
    openGraph: {
      title: finalTitle,
      description: finalDesc,
      url: targetUrl,
      type: "website",
      images: ogImages,
    },
    twitter: {
      card: "summary_large_image",
      title: finalTitle,
      description: finalDesc,
      images: ogImages ? ogImages.map((i) => i.url) : undefined,
    },
  };
}

export default async function Page({
  searchParams,
}: {
  searchParams?: SearchParamsInput;
}) {
  const { id, title, desc, image } = await resolveSearchParams(searchParams);

  const prettyTitle = title || "Service on VextUp";
  const prettyDesc =
    desc ||
    "Open this service on VextUp to see full details, pricing and availability.";
  const targetUrl = id ? `/video/${id}` : "/";

  return (
    <main className="min-h-screen flex items-center justify-center bg-black text-white">
      <div className="max-w-md w-full px-6 text-center">
        {image && (
          <div className="mb-4">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={image}
              alt={prettyTitle}
              className="w-full h-48 object-cover rounded-lg"
            />
          </div>
        )}
        <h1 className="text-lg font-semibold mb-2">{prettyTitle}</h1>
        <p className="text-sm text-gray-300 mb-6">{prettyDesc}</p>
        <a
          href={targetUrl}
          className="inline-flex items-center justify-center px-4 py-2 rounded-full bg-emerald-500 hover:bg-emerald-600 text-sm font-medium"
        >
          Open in VextUp
        </a>
      </div>
    </main>
  );
}