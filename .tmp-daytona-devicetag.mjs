import { Daytona } from '@daytona/sdk';
const daytona = new Daytona();
const sb = await daytona.get('b8625c83-5123-4265-93e6-b80894973f20');
try { await sb.start(); } catch(e) {}
const baseUrl = 'http://localhost:8734';

const script = `import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { initState } from '../src/config.mjs';
import { ensureIdentity } from '../src/keys.mjs';
import { createDataItem } from '../src/dataitem.mjs';

const baseUrl = process.argv[2] || 'http://localhost:8734';
const deviceTag = process.argv[3] || '~reference@1.0';
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'ref-test-'));
process.env.PERMABRAIN_HOME = home;
initState({ env: process.env });
const { identity } = await ensureIdentity(home, { keyType: 'ed25519' });

const tags = [
  { name: 'Data-Protocol', value: 'ao' },
  { name: 'Type', value: 'Message' },
  { name: 'Variant', value: 'ao.TN.1' },
  { name: 'device', value: deviceTag },
  { name: 'reference-value-current-version', value: 'v1-test' },
];
const item = await createDataItem({ payload: JSON.stringify({ 'current-version': 'v1-test' }), tags, identity });
const bytes = Buffer.from(item.ans104Base64, 'base64url');

const res = await fetch(baseUrl + '/~bundler@1.0/tx?codec-device=ans104@1.0', {
  method: 'POST',
  headers: { 'content-type': 'application/octet-stream' },
  body: new Blob([bytes], { type: 'application/octet-stream' })
});
const text = await res.text();
console.log('device tag:', deviceTag);
console.log('status:', res.status);
console.log('body head:', text.slice(0, 500));
`;

await sb.process.executeCommand(`cat > /tmp/permabrain-insandbox/scripts/ref-device-test.mjs <<'SCRIPT_EOF'\n${script}\nSCRIPT_EOF`, undefined, undefined, 30);

const r1 = await sb.process.executeCommand(`cd /tmp/permabrain-insandbox && node scripts/ref-device-test.mjs ${baseUrl} '~reference@1.0'`, undefined, undefined, 60);
console.log('WITH TILDE:');
console.log(r1.result);
const r2 = await sb.process.executeCommand(`cd /tmp/permabrain-insandbox && node scripts/ref-device-test.mjs ${baseUrl} 'reference@1.0'`, undefined, undefined, 60);
console.log('WITHOUT TILDE:');
console.log(r2.result);
