import fs from 'node:fs';
const baseUrl = fs.readFileSync('.hb-edge-url', 'utf8').trim();

// Create a minimal fake ANS-104 item bytes (not valid, but tests header handling)
const bytes = Buffer.from('ANS104-binary-stub');

async function tryUpload(label, headers) {
  const res = await fetch(`${baseUrl}/~bundler@1.0/tx?codec-device=ans104@1.0`, {
    method: 'POST',
    headers: { 'content-type': 'application/octet-stream', ...headers },
    body: bytes,
  });
  const text = await res.text();
  console.log(label, 'status', res.status, 'ctype', res.headers.get('content-type'), text.slice(0, 120));
}

await tryUpload('with Accept json', { Accept: 'application/json' });
await tryUpload('without Accept', {});
await tryUpload('with Accept */*', { Accept: '*/*' });
