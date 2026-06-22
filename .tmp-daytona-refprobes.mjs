import { Daytona } from '@daytona/sdk';
const daytona = new Daytona();
const sb = await daytona.get('b8625c83-5123-4265-93e6-b80894973f20');
try { await sb.start(); } catch(e) {}

const repoDir = '/tmp/permabrain-insandbox';
const patchPath = `${repoDir}/scripts/hb-json-accept-patch.mjs`;
const baseUrl = 'http://localhost:8734';

// Create adapted live reference probe
const liveProbe = `import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { initState } from './src/config.mjs';
import { ensureIdentity } from './src/keys.mjs';
import { HyperbeamTransport } from './src/transport.mjs';

const baseUrl = process.argv[2] || 'http://localhost:8734';
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'permabrain-live-ref-probe-'));
process.env.PERMABRAIN_HOME = home;
process.env.PERMABRAIN_TRANSPORT = 'hyperbeam';
process.env.PERMABRAIN_HYPERBEAM_URL = baseUrl;

initState({ env: process.env });
const { identity } = await ensureIdentity(home, { keyType: 'ed25519' });

const config = {
  gateway: { dataUrl: baseUrl, graphqlUrl: \`\${baseUrl}/graphql\` },
  bundler: { uploadUrl: \`\${baseUrl}/~bundler@1.0/tx?codec-device=ans104@1.0\` },
};
const transport = new HyperbeamTransport(config);

const key = \`subject/live-ref-probe-\${Date.now().toString(36)}\`;
const v1 = \`article-v1-\${Date.now().toString(36)}\`;
const v2 = \`article-v2-\${Date.now().toString(36)}\`;

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

let value = resolved;
if (resolved \u0026\u0026 typeof resolved === 'object') {
  if (resolved['current-version'] !== undefined) value = resolved['current-version'];
  else if (resolved['ao-result'] !== undefined) value = resolved['ao-result'];
}

const ok = value === v2 || (resolved \u0026\u0026 resolved['current-version'] === v2);
console.log('');
console.log(ok ? 'LIVE REFERENCE PROBE OK' : 'LIVE REFERENCE PROBE FAILED');

fs.rmSync(home, { recursive: true, force: true });
process.exit(ok ? 0 : 1);
`;

const directProbe = `import fs from 'node:fs';
const baseUrl = process.argv[2] || 'http://localhost:8734';

async function device(path, method = 'GET', body) {
  const init = { method, headers: { Accept: 'application/json' } };
  if (body) {
    init.headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(body);
  }
  const res = await fetch(\`\${baseUrl}\${path}\`, init);
  const text = await res.text();
  return { status: res.status, text };
}

const probeValue = \`probe-\${Date.now()}\`;
console.log('POST reference record:', probeValue);
const post = await device('/~reference@1.0', 'POST', { value: probeValue, note: 'direct live probe' });
console.log('POST status', post.status);

console.log('GET reference records:');
const list = await device('/~reference@1.0');
console.log('GET status', list.status);

const ok = post.status === 200 \u0026\u0026 list.status === 200;
console.log(ok ? 'DIRECT REFERENCE PROBE OK' : 'DIRECT REFERENCE PROBE FAILED');
process.exit(ok ? 0 : 1);
`;

await sb.process.executeCommand(`cat \u003e ${repoDir}/scripts/hb-live-reference-probe.mjs \u003c\u003c'PROBE_EOF'\n${liveProbe}\nPROBE_EOF`, undefined, undefined, 30);
await sb.process.executeCommand(`cat \u003e ${repoDir}/scripts/hb-direct-reference-test.mjs \u003c\u003c'DIRECT_EOF'\n${directProbe}\nDIRECT_EOF`, undefined, undefined, 30);

const baseEnv = `PERMABRAIN_TRANSPORT=hyperbeam PERMABRAIN_HYPERBEAM_URL=${baseUrl} PERMABRAIN_REQUIRE_HYPERBEAM=1 NODE_OPTIONS="--import ${patchPath}"`;

const live = await sb.process.executeCommand(`cd ${repoDir} \u0026\u0026 ${baseEnv} node scripts/hb-live-reference-probe.mjs ${baseUrl}`, undefined, undefined, 120);
console.log('live reference probe exit', live.exitCode);
console.log(live.result.slice(-3000));

const direct = await sb.process.executeCommand(`cd ${repoDir} \u0026\u0026 node scripts/hb-direct-reference-test.mjs ${baseUrl}`, undefined, undefined, 60);
console.log('direct reference probe exit', direct.exitCode);
console.log(direct.result.slice(-2000));
