import fs from 'node:fs';
const baseUrl = fs.readFileSync('.hb-edge-url', 'utf8').trim();
const r = await fetch(baseUrl, { method: 'GET', headers: { Accept: 'application/json' } });
console.log('status', r.status);
console.log('content-type', r.headers.get('content-type'));
const text = await r.text();
console.log(text.slice(0, 200));
