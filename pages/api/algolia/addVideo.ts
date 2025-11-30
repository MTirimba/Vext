// /workspaces/Vext/pages/api/algolia/addVideo.ts
import type { NextApiRequest, NextApiResponse } from 'next';
import algoliasearch from 'algoliasearch';

const client = algoliasearch(
  process.env.ALGOLIA_APP_ID!,
  process.env.ALGOLIA_ADMIN_KEY! // server-side only
);
const INDEX = process.env.ALGOLIA_INDEX_NAME || 'videos';
const index = client.initIndex(INDEX);

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).end();
  }

  try {
    const video = req.body as any;
    // Expected Firestore shape (flexible):
    // {
    //   id, title, description, userId, createdAt, serviceCost,
    //   media?: Array<{ url: string, type?: 'image'|'video', name?: string }>,
    //   url?: string (legacy single media),
    //   coverUrl?: string,
    //   tags?: string[], location?, categories?
    // }

    const media: Array<{ url: string; type?: string; name?: string }> =
      Array.isArray(video.media) && video.media.length > 0
        ? video.media
        : (video.url ? [{ url: video.url, type: inferType(video.url) }] : []);

    const record = {
      objectID: video.id,              // required
      id: video.id,                    // convenient duplicate
      title: video.title || '',
      description: video.description || '',
      userId: video.userId || null,
      serviceCost: video.serviceCost ?? null,
      createdAt: video.createdAt ?? Date.now(),
      tags: Array.isArray(video.tags) ? video.tags : [],
      location: video.location || null,
      categories: Array.isArray(video.categories) ? video.categories : [],

      // multi-media support
      media,                           // full media list for stacked posts
      hasCarousel: media.length > 1,
      coverUrl: video.coverUrl || firstMediaUrl(media) || video.url || null,

      // light “content type” facet (image/video/mixed)
      contentType: contentKind(media),
    };

    await index.saveObject(record);
    return res.status(200).json({ success: true });
  } catch (e: any) {
    console.error('algolia addVideo error:', e);
    return res.status(500).json({ error: e.message || 'Failed to add to Algolia' });
  }
}

function inferType(url: string): 'image' | 'video' {
  const u = (url || '').split('?')[0].toLowerCase();
  if (/\.(png|jpe?g|gif|webp|avif|bmp)$/.test(u) || url.startsWith('data:image')) return 'image';
  return 'video';
}
function firstMediaUrl(media: Array<{ url: string }>) {
  return media?.[0]?.url || null;
}
function contentKind(media: Array<{ url: string; type?: string }>) {
  if (!media?.length) return 'unknown';
  const types = new Set(media.map(m => (m.type || inferType(m.url))));
  if (types.size === 1) return types.has('image') ? 'image' : 'video';
  return 'mixed';
}