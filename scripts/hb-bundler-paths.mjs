import fs from 'node:fs';
const baseUrl = fs.readFileSync('.hb-edge-url', 'utf8').trim();
const bytes = Buffer.from('ANS104-binary-stub');
const paths = [
  `${baseUrl}/~bundler@1.0`,
  `${baseUrl}/~bundler@1.0/tx`,
  `${baseUrl}/~bundler@1.0/tx?codec-device=ans104@1.0`,
];
for (const url of paths) {
  const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/octet-stream', Accept: 'application/json' }, body: bytes });
  const text = await res.text();
  console.log(url, 'status', res.status, 'ctype', res.headers.get('content-type'), text.slice(0, 80));
}
