import fs from 'node:fs';
const baseUrl = fs.readFileSync('.hb-edge-url', 'utf8').trim();

async function device(path, method = 'GET', body) {
  const init = { method, headers: { Accept: 'application/json' } };
  if (body) { init.headers['Content-Type'] = 'application/json'; init.body = JSON.stringify(body); }
  const res = await fetch(`${baseUrl}${path}`, init);
  const text = await res.text();
  try { return { status: res.status, json: JSON.parse(text), text }; } catch { return { status: res.status, text }; }
}

const probeValue = `probe-${Date.now()}`;
console.log('POST', probeValue);
const post = await device('/~reference@1.0', 'POST', { value: probeValue });
console.log('POST status', post.status);
console.log(JSON.stringify(post.json, null, 2).slice(0, 800));

console.log('\nGET');
const list = await device('/~reference@1.0');
console.log('GET status', list.status);
console.log(JSON.stringify(list.json, null, 2).slice(0, 1200));
