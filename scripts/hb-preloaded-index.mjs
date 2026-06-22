import fs from 'node:fs';
const baseUrl = fs.readFileSync('.hb-edge-url', 'utf8').trim();
const meta = await fetch(`${baseUrl}/~meta@1.0/info`, { headers: { Accept: 'application/json' } });
const metaText = await meta.text();
const metaJson = JSON.parse(metaText);
console.log('preloaded-devices-index', metaJson['preloaded-devices-index']);
const idx = metaJson['preloaded-devices-index'];

// Try resolving index id as raw message with no Accept (httpsig)
const r = await fetch(`${baseUrl}/${encodeURIComponent(idx)}`);
console.log('resolve index status', r.status, 'ctype', r.headers.get('content-type'));
const text = await r.text();
console.log(text.slice(0, 800));
