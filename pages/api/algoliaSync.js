// /workspaces/Vext/pages/api/algoliaSync.js
import algoliasearch from 'algoliasearch';
import { db } from '@/lib/firebase';
import { collection, getDocs } from 'firebase/firestore';

/** @type {import('next').NextApiHandler} */
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const appId = process.env.ALGOLIA_APP_ID || process.env.NEXT_PUBLIC_ALGOLIA_APP_ID;
  const adminKey = process.env.ALGOLIA_ADMIN_KEY; // keep secret (server-side only)

  // ✅ canonical index name = "videos"
  const indexName = process.env.ALGOLIA_INDEX_NAME || 'videos';

  if (!appId || !adminKey) {
    return res.status(500).json({ error: 'Missing Algolia env vars' });
  }

  try {
    const client = algoliasearch(appId, adminKey);
    const index = client.initIndex(indexName);

    // fetch videos/services from Firestore
    const snap = await getDocs(collection(db, 'videos'));
    const records = snap.docs.map((doc) => ({
      objectID: doc.id, // required by Algolia
      ...doc.data(),
    }));

    if (records.length) {
      await index.saveObjects(records);
    }

    return res.status(200).json({ indexed: records.length, indexName });
  } catch (error) {
    console.error('algoliaSync error:', error);
    return res.status(500).json({ error: 'Indexing failed' });
  }
}