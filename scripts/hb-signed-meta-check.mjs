import fs from 'node:fs';
const baseUrl = fs.readFileSync('.hb-edge-url', 'utf8').trim();
const res = await fetch(`${baseUrl}/~meta@1.0/info`, { headers: { Accept: 'application/json' } });
console.log('status', res.status, 'ctype', res.headers.get('content-type'));
const text = await res.text();
console.log(text.slice(0, 200));
