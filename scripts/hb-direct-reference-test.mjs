import fs from 'node:fs';
const baseUrl = fs.readFileSync('.hb-edge-url', 'utf8').trim();

async function device(path, method = 'GET', body) {
  const init = { method, headers: { Accept: 'application/json' } };
  if (body) {
    init.headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(body);
  }
  const res = await fetch(`${baseUrl}${path}`, init);
  const text = await res.text();
  return { status: res.status, text };
}

const probeValue = `probe-${Date.now()}`;
console.log('POST reference record:', probeValue);
const post = await device('/~reference@1.0', 'POST', { value: probeValue, note: 'direct live probe' });
console.log('POST status', post.status);

console.log('GET reference records:');
const list = await device('/~reference@1.0');
console.log('GET status', list.status);

const ok = post.status === 200 && list.status === 200;
console.log(ok ? 'DIRECT REFERENCE PROBE OK' : 'DIRECT REFERENCE PROBE FAILED');
process.exit(ok ? 0 : 1);
