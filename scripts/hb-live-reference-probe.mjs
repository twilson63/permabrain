import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { initState } from '../permabrain/src/config.mjs';
import { ensureIdentity } from '../permabrain/src/keys.mjs';
import { HyperbeamTransport } from '../permabrain/src/transport.mjs';

const baseUrl = process.argv[2] || fs.readFileSync('.hb-edge-url', 'utf8').trim();
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'permabrain-live-ref-probe-'));
process.env.PERMABRAIN_HOME = home;
process.env.PERMABRAIN_TRANSPORT = 'hyperbeam';
process.env.PERMABRAIN_HYPERBEAM_URL = baseUrl;

initState({ env: process.env });
const { identity } = await ensureIdentity(home, { keyType: 'ed25519' });

const config = {
  gateway: { dataUrl: baseUrl, graphqlUrl: `${baseUrl}/graphql` },
  bundler: { uploadUrl: `${baseUrl}/~bundler@1.0/tx?codec-device=ans104@1.0` },
};
const transport = new HyperbeamTransport(config);

const key = `subject/live-ref-probe-${Date.now().toString(36)}`;
const v1 = `article-v1-${Date.now().toString(36)}`;
const v2 = `article-v2-${Date.now().toString(36)}`;

console.log('Creating reference...');
const created = await transport.createArticleReference(key, v1, identity);
console.log('created:', created);

let resolved = await transport.resolveReference(created.referenceId);
console.log('resolve (v1):', resolved);

console.log('Updating reference...');
const updated = await transport.updateArticleReference(created.referenceId, v2, identity);
console.log('updated:', updated);

resolved = await transport.resolveReference(created.referenceId);
console.log('resolve (v2):', resolved);

// Extract current-version from the resolved value (may be wrapped in AO message)
let value = resolved;
if (resolved && typeof resolved === 'object') {
  if (resolved['current-version'] !== undefined) value = resolved['current-version'];
  else if (resolved['ao-result'] !== undefined) value = resolved['ao-result'];
}

const ok = value === v2 || (resolved && resolved['current-version'] === v2);
console.log('');
console.log(ok ? 'LIVE REFERENCE PROBE OK' : 'LIVE REFERENCE PROBE FAILED');

fs.rmSync(home, { recursive: true, force: true });
process.exit(ok ? 0 : 1);
