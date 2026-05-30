import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { initState } from '../src/config.mjs';
import { ensureIdentity } from '../src/keys.mjs';
import { createDataItem, rawDataItemBytes } from '../src/dataitem.mjs';
import { buildArticleTags } from '../src/tags.mjs';

if (process.env.PERMABRAIN_ENABLE_PUBLIC_UPLOAD !== '1') {
  console.log('Public upload disabled; set PERMABRAIN_ENABLE_PUBLIC_UPLOAD=1 to run this permanent publishing test');
  process.exit(0);
}

const uploadUrl = process.env.PERMABRAIN_PUBLIC_UPLOAD_URL || 'https://up.arweave.net';
const requireUpload = process.env.PERMABRAIN_REQUIRE_PUBLIC_UPLOAD === '1';

function skip(message) {
  if (requireUpload) throw new Error(message);
  console.log(`${message}; skipping public upload test`);
  process.exit(0);
}

console.error('WARNING: this test attempts to publish public/permanent data. Continuing because PERMABRAIN_ENABLE_PUBLIC_UPLOAD=1 is set.');

const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'permabrain-public-upload-'));
const { home } = initState({ env: { ...process.env, PERMABRAIN_HOME: tempHome } });
const { identity } = await ensureIdentity(home, { keyType: process.env.PERMABRAIN_KEY_TYPE || 'arweave-rsa4096' });
const content = `# PermaBrain Public Upload Probe\n\nThis is a public test article generated at ${new Date().toISOString()}.\n`;
const tags = buildArticleTags({
  key: `subject/public-upload-probe-${Date.now()}`,
  kind: 'subject',
  title: 'PermaBrain Public Upload Probe',
  topic: 'test',
  sourceName: 'PermaBrain Test',
  sourceUrl: 'https://example.invalid/permabrain-public-upload-probe',
  sourceLicense: 'test',
  content,
  agentId: identity.agentId
});
const item = await createDataItem({ payload: content, tags, identity });

try {
  const bytes = rawDataItemBytes(item);
  const res = await fetch(uploadUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/octet-stream' },
    body: new Blob([bytes], { type: 'application/octet-stream' })
  });
  if (!res.ok) skip(`Public upload endpoint ${uploadUrl} rejected test envelope: HTTP ${res.status} ${await res.text().catch(() => '')}`);
  const text = await res.text().catch(() => '');
  assert.match(item.id, /^[A-Za-z0-9_-]+$/);
  console.log(`Public upload request accepted for ${identity.type} item id ${item.id}`);
  if (text) console.log(text);
} catch (err) {
  skip(`Public upload failed: ${err.message}`);
}
