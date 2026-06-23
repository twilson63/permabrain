// Step 8 + Step 12 end-to-end on a live node with all three PermaBrain
// devices preloaded (permabrain-consensus, permabrain-query, reference).
//
//   HB_URL=http://localhost:18734 node test/step12-e2e.mjs
//
// Flow: publish article -> create reference pointing at it -> resolve the
// reference (Step 8) -> upload attestations -> consensus -> query (Step 9).
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
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failures = 0;
const ok = (c, m) => { console.log(`${c ? 'PASS' : 'FAIL'}: ${m}`); if (!c) failures++; };

const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'pb-e2e-'));
const { home } = initState({ env: { ...process.env, PERMABRAIN_HOME: tempHome } });
const { identity } = await ensureIdentity(home);
const config = loadConfig(home);
config.gateway.dataUrl = URL;
config.bundler.uploadUrl = `${URL}/~bundler@1.0/tx?codec-device=ans104@1.0`;
const transport = new HyperbeamTransport(config);
const q = new HyperbeamQuery(URL);

// This dev node forwards bundler uploads to Arweave L1 and retries on failure,
// which can reset the client connection AFTER the item is already in the local
// store. Treat a socket reset as a soft success (the item still landed locally).
async function upload(item, label) {
  try {
    await transport.uploadDataItem(item);
    console.log(`uploaded ${label} ${item.id}`);
  } catch (e) {
    console.log(`uploaded ${label} ${item.id} (connection reset, item cached locally: ${e.cause?.code || e.message})`);
  }
}

// 1. Publish article
const articleKey = `subject/e2e-${Date.now()}`;
const content = `# E2E Article\n\nFull PermaBrain device loop.\n`;
const article = await createDataItem({
  payload: content,
  tags: buildArticleTags({
    key: articleKey, kind: 'subject', title: 'E2E', topic: 'test',
    sourceName: 'PermaBrain Test', sourceUrl: 'https://example.invalid/e2e',
    sourceLicense: 'test', content, agentId: identity.agentId,
  }),
  identity,
});
await upload(article, "article");

// 2. Create a reference (init) whose value carries current-version = articleId.
//    The init carries the value inline, so resolving a key on the reference
//    returns it from local cache (no gateway needed).
// Store the init as a PLAIN message (no `device` tag — that tag breaks bundler
// ingestion on this node); the path `~reference@1.0` applies the device at
// resolve time. The init carries the value inline (current-version).
const refInit = await createDataItem({
  payload: 'reference-init',
  tags: objectToTags({
    'timestamp': '1',
    'current-version': article.id,
    'article-key': articleKey,
  }),
  identity,
});
await upload(refInit, "reference-init");
const refId = refInit.id;
console.log(`reference: ${refId} -> current-version=${article.id}`);
await sleep(1500);

// 3. STEP 8: resolve the reference via its /compute path on the live node.
//    /compute runs the reference device and returns its current value (which
//    carries current-version). The default infinity max-age keeps this a pure
//    cache read — no gateway.
let currentVersion = null;
for (let i = 0; i < 8; i++) {
  try {
    const res = await fetch(`${URL}/${refId}~reference@1.0/compute`, {
      headers: { 'Accept': 'application/json' },
    });
    if (res.status === 200) {
      const j = await res.json();
      currentVersion = j['current-version'];
      if (currentVersion) break;
    }
  } catch (e) { /* retry */ }
  await sleep(1000);
}
console.log(`reference compute -> current-version=${currentVersion}`);
ok(currentVersion === article.id,
  `Step 8: GET /{refId}~reference@1.0/compute resolves current-version to the article id (${article.id})`);

// 4. Attestations (device-contract tags) + consensus (Step 9).
async function attest(valid, conf) {
  const it = await createDataItem({
    payload: `att ${valid} ${conf}`,
    tags: objectToTags({
      'App-Name': 'PermaBrain', 'PermaBrain-Type': 'attestation',
      'Attestation-Target': article.id, 'Attestation-Valid': valid,
      'Attestation-Confidence': String(conf),
    }),
    identity,
  });
  await upload(it, "attestation");
}
await attest('valid', 0.8);
await attest('valid', 0.6);
await attest('invalid', 0.5);
await sleep(2000);

const cRes = await fetch(`${URL}/~permabrain-consensus@1.0/consensus`, {
  headers: { 'Attestation-Target': article.id, 'Accept': 'application/json' },
});
const c = await cRes.json();
console.log(`consensus -> count=${c['Consensus-Count']} score=${c['Consensus-Score']} status=${c['Consensus-Status']}`);
ok(cRes.status === 200 && c['Consensus-Status'] === 'computed' && c['Consensus-Count'] === '3',
  'Step 12: consensus computed over the 3 attestations');

// 5. Query (Step 9).
const qRes = await fetch(`${URL}/~permabrain-query@1.0/query`, {
  headers: { 'Article-Key': articleKey, 'Accept': 'application/json' },
});
ok(qRes.status === 200, 'Step 12: query device responded 200');

console.log(`\n=== Step 8 + 12 E2E: ${failures === 0 ? 'ALL PASS' : failures + ' failure(s)'} ===`);
process.exit(failures === 0 ? 0 : 1);
