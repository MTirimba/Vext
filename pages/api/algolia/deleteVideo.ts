import type { NextApiRequest, NextApiResponse } from 'next';
import algoliasearch from 'algoliasearch';

const client = algoliasearch(
  process.env.ALGOLIA_APP_ID!,
  process.env.ALGOLIA_ADMIN_KEY!
);
const INDEX = process.env.ALGOLIA_INDEX_NAME || 'videos';
const index = client.initIndex(INDEX);

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).end();
  }
  try {
    const { id } = req.body as { id: string };
    if (!id) return res.status(400).json({ error: 'Missing id' });
    await index.deleteObject(id);
    return res.status(200).json({ success: true });
  } catch (e: any) {
    console.error('algolia delete error:', e);
    return res.status(500).json({ error: e.message || 'Delete failed' });
  }
}