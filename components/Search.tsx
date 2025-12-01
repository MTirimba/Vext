'use client';

import algoliasearch from 'algoliasearch/lite'; // ✅ default import + lite client
import { InstantSearch, SearchBox, Hits } from 'react-instantsearch-hooks-web';

const searchClient = algoliasearch(
  process.env.NEXT_PUBLIC_ALGOLIA_APP_ID!,
  process.env.NEXT_PUBLIC_ALGOLIA_SEARCH_KEY!
);

export default function Search() {
  return (
    <InstantSearch searchClient={searchClient} indexName="services_index">
      <SearchBox placeholder="Search services..." />
      <Hits hitComponent={({ hit }) => <div>{hit.name}</div>} />
    </InstantSearch>
  );
}