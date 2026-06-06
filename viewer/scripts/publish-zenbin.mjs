import crypto from 'node:crypto';
import fs from 'node:fs';

const keyId = 'dev1-key-1779107912508';
const privateKeyJwk = { crv: 'Ed25519', d: 'uG4rsZfaMrp6OTQaWY9SyimcBLaUfi3R-FBcovTNuIQ', x: 'VNwCdReytqk_dtPgMOOTQn_wUaejDMTYjtC0ymPEhSg', kty: 'OKP' };

import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
const __dirname = dirname(fileURLToPath(import.meta.url));

const html = fs.readFileSync(join(__dirname, '..', 'index.html'), 'utf8');

async function main() {
  const privateKey = await crypto.subtle.importKey('jwk', privateKeyJwk, { name: 'Ed25519' }, false, ['sign']);

  const pageId = 'permabrain-viewer';
  const body = JSON.stringify({ html, title: 'PermaBrain Viewer' });
  const bodyBytes = new TextEncoder().encode(body);

  const digest = await crypto.subtle.digest('SHA-256', bodyBytes);
  const contentDigest = 'sha-256=:' + Buffer.from(digest).toString('base64') + ':';

  const timestamp = new Date().toISOString();
  const nonce = crypto.randomUUID();

  const canonical = `POST\n/v1/pages/${pageId}\n${timestamp}\n${nonce}\n${contentDigest}`;
  const canonicalBytes = new TextEncoder().encode(canonical);

  const signature = await crypto.subtle.sign('Ed25519', privateKey, canonicalBytes);
  const signatureB64url = Buffer.from(signature).toString('base64url');

  const res = await fetch(`https://zenbin.org/v1/pages/${pageId}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Zenbin-Key-Id': keyId,
      'X-Zenbin-Timestamp': timestamp,
      'X-Zenbin-Nonce': nonce,
      'Content-Digest': contentDigest,
      'X-Zenbin-Signature': `:${signatureB64url}:`
    },
    body
  });

  const result = await res.text();
  console.log('Status:', res.status);
  console.log('Response:', result);
}

main().catch(err => console.error(err));