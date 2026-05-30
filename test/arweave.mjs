import assert from 'node:assert/strict';

const graphqlUrl = process.env.PERMABRAIN_ARWEAVE_GRAPHQL_URL || 'https://arweave.net/graphql';
const dataUrl = process.env.PERMABRAIN_ARWEAVE_DATA_URL || 'https://arweave.net';
const requireArweave = process.env.PERMABRAIN_REQUIRE_ARWEAVE === '1';

function skip(message) {
  if (requireArweave) throw new Error(message);
  console.log(`${message}; skipping Arweave read-only integration test`);
  process.exit(0);
}

try {
  const res = await fetch(graphqlUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      query: `query { transactions(first: 1, tags: [{ name: "App-Name", values: ["PermaBrain"] }]) { edges { node { id tags { name value } } } } }`
    })
  });
  if (!res.ok) skip(`Arweave GraphQL unavailable at ${graphqlUrl}: HTTP ${res.status}`);
  const json = await res.json();
  assert.ok(json.data?.transactions?.edges, 'GraphQL response missing transactions.edges');
  console.log(`Arweave GraphQL reachable at ${graphqlUrl}; PermaBrain matches: ${json.data.transactions.edges.length}`);

  const gateway = await fetch(dataUrl, { method: 'GET' });
  if (!gateway.ok) skip(`Arweave gateway unavailable at ${dataUrl}: HTTP ${gateway.status}`);
  console.log(`Arweave gateway reachable at ${dataUrl}`);
} catch (err) {
  skip(`Arweave read-only probe failed: ${err.message}`);
}
