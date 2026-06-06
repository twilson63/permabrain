import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createDataItem } from '../../src/dataitem.mjs';
import { loadIdentity } from '../../src/keys.mjs';
import { getHome } from '../../src/config.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const home = getHome();
const identity = loadIdentity(home);
const content = fs.readFileSync(join(__dirname, '..', 'index.html'), 'utf8');

const tags = [
  { name: 'App-Name', value: 'PermaBrain-Viewer' },
  { name: 'App-Version', value: '1.0.0' },
  { name: 'Content-Type', value: 'text/html' },
  { name: 'PermaBrain-Type', value: 'app' },
  { name: 'App-Title', value: 'PermaBrain Viewer' },
  { name: 'Author-Agent-Id', value: identity.agentId }
];

const item = await createDataItem({ payload: content, tags, identity });
const rawBytes = Buffer.from(item.ans104Base64, 'base64url');

console.log('Uploading', rawBytes.length, 'bytes to up.arweave.net...');
console.log('Item ID:', item.id);

const res = await fetch('https://up.arweave.net/tx', {
  method: 'POST',
  headers: { 'Content-Type': 'application/octet-stream' },
  body: new Uint8Array(rawBytes)
});

console.log('Status:', res.status);
const text = await res.text();
console.log('Response:', text.substring(0, 500));