import algoliasearch from 'algoliasearch'; // works if esModuleInterop=true
// OR: import { algoliasearch } from 'algoliasearch'; // if no esModuleInterop

const client = algoliasearch(
  'YOUR_APP_ID',
  'YOUR_ADMIN_API_KEY'
);

const index = client.initIndex('services_index');

async function run() {
  const records = [
    { objectID: '1', name: 'Sample Service 1' },
    { objectID: '2', name: 'Sample Service 2' }
  ];

  try {
    const response = await index.saveObjects(records);
    console.log('✅ Data uploaded to Algolia:', response);
  } catch (error) {
    console.error('❌ Upload failed:', error);
  }
}

run();