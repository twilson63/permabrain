// Step 9 live-node test: exercise the PermaBrain query + consensus Forge
// devices against a running HyperBEAM node that has them preloaded.
//
// Usage:
//   HB_URL=http://localhost:18734 node test/step9-devices.mjs
//
// Skips gracefully (exit 0) if no node is reachable, unless
// PERMABRAIN_REQUIRE_HYPERBEAM=1 is set.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { initState, loadConfig } from '../src/config.mjs';
import { ensureIdentity } from '../src/keys.mjs';
import { createDataItem } from '../src/dataitem.mjs';
import { HyperbeamTransport } from '../src/transport.mjs';
import { HyperbeamQuery } from '../src/hb-query.mjs';
import { buildArticleTags, objectToTags } from '../src/tags.mjs';

const URL = process.env.HB_URL || 'http://localhost:18734';
const required = process.env.PERMABRAIN_REQUIRE_HYPERBEAM === '1';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function skip(message) {
  if (required) throw new Error(message);
  console.log(`${message}; skipping device integration test`);
  process.exit(0);
}

// Health check
try {
  const res = await fetch(`${URL}/~permabrain-consensus@1.0/info`, {
    headers: { Accept: 'application/json' },
  });
  if (!res.ok) skip(`consensus device not available at ${URL} (HTTP ${res.status})`);
} catch (err) {
  skip(`HyperBEAM unreachable at ${URL}: ${err.message}`);
}

const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'pb-step9-'));
const { home } = initState({ env: { ...process.env, PERMABRAIN_HOME: tempHome } });
const { identity } = await ensureIdentity(home);
const config = loadConfig(home);
config.gateway.dataUrl = URL;
config.bundler.uploadUrl = `${URL}/~bundler@1.0/tx?codec-device=ans104@1.0`;
const transport = new HyperbeamTransport(config);
const q = new HyperbeamQuery(URL);

// 1. Upload an article
const articleKey = `subject/step9-${Date.now()}`;
const content = `# Step9 Test Article\n\nConsensus device verification.\n`;
const article = await createDataItem({
  payload: content,
  tags: buildArticleTags({
    key: articleKey, kind: 'subject', title: 'Step9 Test', topic: 'test',
    sourceName: 'PermaBrain Test', sourceUrl: 'https://example.invalid/step9',
    sourceLicense: 'test', content, agentId: identity.agentId,
  }),
  identity,
});
await transport.uploadDataItem(article);
console.log(`Uploaded article ${article.id} (key=${articleKey})`);

// 2. Upload attestations using the device-contract tags the Lua/Erlang
//    consensus device expects: Attestation-Target / Attestation-Valid /
//    Attestation-Confidence.
async function uploadAttestation(valid, confidence) {
  const item = await createDataItem({
    payload: `attestation ${valid} ${confidence}`,
    tags: objectToTags({
      'App-Name': 'PermaBrain',
      'PermaBrain-Type': 'attestation',
      'Attestation-Target': article.id,
      'Attestation-Valid': valid,
      'Attestation-Confidence': String(confidence),
    }),
    identity,
  });
  await transport.uploadDataItem(item);
  console.log(`Uploaded attestation ${item.id} (${valid}, conf=${confidence})`);
}
await uploadAttestation('valid', 0.9);
await uploadAttestation('valid', 0.7);
await uploadAttestation('invalid', 0.4);

await sleep(2000); // allow the node to index tags into the match store

// 3. Query the article via ~query@1.0 (should not error)
const queryResult = await q.query(
  { 'App-Name': 'PermaBrain', 'Article-Key': articleKey },
  { returnType: 'messages' }
);
assert.ok(queryResult != null, 'query device returned a response for the article key');
console.log('PASS: ~query@1.0 responded');

// 4. Consensus via the permabrain-consensus device.
//    Expected: 2 valid (0.9+0.7) - 1 invalid (0.4) = 1.2 net / 3 = 0.4 avg.
const cRes = await fetch(`${URL}/~permabrain-consensus@1.0/consensus`, {
  headers: { 'Attestation-Target': article.id, Accept: 'application/json' },
});
assert.equal(cRes.status, 200, 'consensus device responded 200');
const c = await cRes.json();
console.log(`consensus result: count=${c['Consensus-Count']} valid=${c['Consensus-Valid-Count']} invalid=${c['Consensus-Invalid-Count']} score=${c['Consensus-Score']} status=${c['Consensus-Status']}`);
assert.equal(c['Consensus-Status'], 'computed', 'consensus computed over the attestations');
assert.equal(c['Consensus-Count'], '3', 'consensus saw all 3 attestations');
assert.equal(c['Consensus-Valid-Count'], '2', 'two valid attestations');
assert.equal(c['Consensus-Invalid-Count'], '1', 'one invalid attestation');
assert.equal(parseFloat(c['Consensus-Score']).toFixed(4), '0.4000', 'weighted score is 0.4');
console.log('PASS: consensus device computed the expected weighted score');

// 5. Query device function responds 200.
const qRes = await fetch(`${URL}/~permabrain-query@1.0/query`, {
  headers: { 'Article-Key': articleKey, Accept: 'application/json' },
});
assert.equal(qRes.status, 200, 'query device responded 200');
console.log('PASS: ~permabrain-query@1.0/query responded');

console.log('\n=== Step 9 device integration: ALL PASS ===');
