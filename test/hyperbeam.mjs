import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { initState, loadConfig } from '../src/config.mjs';
import { ensureIdentity } from '../src/keys.mjs';
import { createDataItem, payloadText } from '../src/dataitem.mjs';
import { HyperbeamTransport } from '../src/transport.mjs';
import { buildArticleTags } from '../src/tags.mjs';

const required = process.env.PERMABRAIN_REQUIRE_HYPERBEAM === '1';
const url = process.env.PERMABRAIN_HYPERBEAM_URL || 'http://localhost:10000';

function skip(message) {
  if (required) throw new Error(message);
  console.log(`${message}; skipping HyperBEAM integration test`);
  process.exit(0);
}

const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'permabrain-hb-'));
let probeJson;
try {
  const probe = spawnSync(process.execPath, ['scripts/cli.mjs', 'probe-hyperbeam', '--url', url, '--json'], {
    encoding: 'utf8',
    env: { ...process.env, PERMABRAIN_HOME: tempHome }
  });
  if (probe.status !== 0) skip(`HyperBEAM probe command failed: ${probe.stderr}`);
  probeJson = JSON.parse(probe.stdout);
} catch (err) {
  skip(`HyperBEAM unavailable at ${url}: ${err.message}`);
}

const check = (name) => probeJson.checks.find((c) => c.name === name);
if (!check('health')?.ok) skip(`HyperBEAM health check failed at ${url}`);
if (!check('graphql')?.ok || !check('upload')?.ok) skip(`HyperBEAM is reachable but required GraphQL/upload routes are not compatible yet`);

const { home } = initState({ env: { ...process.env, PERMABRAIN_HOME: tempHome } });
const { identity } = await ensureIdentity(home);
const config = loadConfig(home);
config.gateway.dataUrl = url;
config.gateway.graphqlUrl = `${url}/graphql`;
config.bundler.uploadUrl = `${url}/~bundler@1.0/tx?codec-device=ans104@1.0`;
const transport = new HyperbeamTransport(config);
const content = '# HyperBEAM Probe\n\nMinimal PermaBrain DataItem.\n';
const tags = buildArticleTags({
  key: 'subject/hyperbeam-probe',
  kind: 'subject',
  title: 'HyperBEAM Probe',
  topic: 'test',
  sourceName: 'PermaBrain Test',
  sourceUrl: 'https://example.invalid/permabrain-test',
  sourceLicense: 'test',
  content,
  agentId: identity.agentId
});
const item = await createDataItem({ payload: content, tags, identity });
await transport.uploadDataItem(item);
const queried = await transport.queryByTags({ 'App-Name': 'PermaBrain', 'PermaBrain-Type': 'article', 'Article-Key': 'subject/hyperbeam-probe' });
assert.ok(Array.isArray(queried));
const fetched = await transport.fetchDataItem(item.id);
assert.equal(payloadText(fetched), content);
console.log(`HyperBEAM upload/query/fetch passed for ${item.id}`);
