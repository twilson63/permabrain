import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { initState } from '../permabrain/src/config.mjs';
import { ensureIdentity } from '../permabrain/src/keys.mjs';
import { createDataItem, rawDataItemBytes } from '../permabrain/src/dataitem.mjs';
import { buildArticleTags } from '../permabrain/src/tags.mjs';

const baseUrl = fs.readFileSync('.hb-edge-url', 'utf8').trim();
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'permabrain-upload-test-'));
process.env.PERMABRAIN_HOME = home;
initState({ env: process.env });
const { identity } = await ensureIdentity(home, { keyType: 'ed25519' });

const content = '# Test\n';
const tags = buildArticleTags({
  key: 'subject/upload-test',
  kind: 'subject',
  title: 'Upload Test',
  topic: 'test',
  sourceName: 'test',
  sourceUrl: 'https://example.invalid/test',
  sourceLicense: 'test',
  content,
  agentId: identity.agentId,
});
const item = await createDataItem({ payload: content, tags, identity });
const bytes = rawDataItemBytes(item);
console.log('item id', item.id, 'bytes', bytes.length);

const res = await fetch(`${baseUrl}/~bundler@1.0/tx?codec-device=ans104@1.0`, {
  method: 'POST',
  headers: { 'content-type': 'application/octet-stream', Accept: 'application/json' },
  body: new Blob([bytes], { type: 'application/octet-stream' }),
});
console.log('upload status', res.status, 'ctype', res.headers.get('content-type'));
const text = await res.text();
console.log(text.slice(0, 300));

if (res.ok) {
  // try fetch
  const fetchRes = await fetch(`${baseUrl}/${encodeURIComponent(item.id)}`);
  console.log('fetch status', fetchRes.status);
  for (const [k, v] of fetchRes.headers.entries()) {
    if (k.startsWith('article-') || k.startsWith('app-') || k.startsWith('permabrain-')) console.log(k, v);
  }
  const body = await fetchRes.text();
  console.log('body', body.slice(0, 100));
}
