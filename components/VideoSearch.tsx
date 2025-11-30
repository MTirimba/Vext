import algoliasearch from 'algoliasearch/lite';
import { InstantSearch, SearchBox, Hits } from 'react-instantsearch-hooks-web';

const searchClient = algoliasearch(
  process.env.NEXT_PUBLIC_ALGOLIA_APP_ID!,
  process.env.NEXT_PUBLIC_ALGOLIA_SEARCH_KEY!
);

export default function VideoSearch() {
  return (
    <InstantSearch searchClient={searchClient} indexName="videos">
      <SearchBox placeholder="Search videos..." />
      <Hits hitComponent={({ hit }) => <div>{hit.title}</div>} />
    </InstantSearch>
  );
}