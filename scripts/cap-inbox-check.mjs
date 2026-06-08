#!/usr/bin/env node
// CAP Protocol inbox check — uses Web Crypto API
// Usage: node scripts/cap-inbox-check.mjs
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

// PermaBrain identity key (Ed25519 JWK)
const privateKeyJwk = { crv: 'Ed25519', d: 'uG4rsZfaMrp6OTQaWY9SyimcBLaUfi3R-FBcovTNuIQ', x: 'VNwCdReytqk_dtPgMOOTQn_wUaejDMTYjtC0ymPEhSg', kty: 'OKP' };
const keyId = 'dev1-key-1779107912508';
const myFingerprint = 'q1D9p4puc0UkWVUD-PEMze2GRH11MLu-Sf1kP7-anMc';

// Load last check state
const lastCheckPath = path.resolve('../skills/cap-message/last-check.json');
const lastCheck = JSON.parse(fs.readFileSync(lastCheckPath, 'utf8'));

const privateKey = await crypto.subtle.importKey('jwk', privateKeyJwk, { name: 'Ed25519' }, false, ['sign']);

const timestamp = new Date().toISOString();
const nonce = crypto.randomUUID();
const since = lastCheck.lastCheck;

const method = 'GET';
// Canonical path does NOT include query string
const canonicalPath = '/v1/pages';
const queryString = `recipient=me&since=${encodeURIComponent(since)}`;
const fullUrl = `https://zenbin.org${canonicalPath}?${queryString}`;

// GET request — empty body digest
const bodyDigest = await crypto.subtle.digest('SHA-256', new Uint8Array(0));
const contentDigest = 'sha-256=:' + Buffer.from(bodyDigest).toString('base64') + ':';

// Canonical string: METHOD\nPATH\nTIMESTAMP\nNONCE\nCONTENT-DIGEST
const canonical = `${method}\n${canonicalPath}\n${timestamp}\n${nonce}\n${contentDigest}`;
const canonicalBytes = new TextEncoder().encode(canonical);

const signature = await crypto.subtle.sign('Ed25519', privateKey, canonicalBytes);
const signatureB64url = Buffer.from(signature).toString('base64url');

const headers = {
  'X-Zenbin-Key-Id': keyId,
  'X-Zenbin-Timestamp': timestamp,
  'X-Zenbin-Nonce': nonce,
  'X-Zenbin-Signature': `:${signatureB64url}:`,
  'Content-Digest': contentDigest,
  'CAP-Recipient-Key-Id': myFingerprint
};

console.log('Checking inbox since:', since);
const resp = await fetch(fullUrl, { headers });
console.log('Status:', resp.status);

if (!resp.ok) {
  const text = await resp.text();
  console.log('Error:', text);
  process.exit(1);
}

const data = await resp.json();
const pages = data.pages || [];
console.log('Pages found:', pages.length);

const processedPages = new Set(lastCheck.processedPages || []);
const newPages = pages.filter(p => !processedPages.has(p.id));

if (newPages.length > 0) {
  const allowlistPath = path.resolve('../skills/cap-message/allowlist.json');
  const allowlist = JSON.parse(fs.readFileSync(allowlistPath, 'utf8'));
  const allowedFingerprints = new Map(allowlist.entries.map(e => [e.fingerprint, e]));

  for (const page of newPages) {
    const senderFp = page.senderFingerprint || page.publicKeyFingerprint || page.keyId || 'unknown';
    const trustEntry = allowedFingerprints.get(senderFp);
    if (trustEntry) {
      console.log(`  ✓ ${page.id}: "${page.title || '(no title)'}" from ${senderFp} (${trustEntry.trustLevel})`);
    } else {
      console.log(`  ✗ ${page.id}: "${page.title || '(no title)'}" from ${senderFp} (not in allowlist - skipped)`);
    }
  }
} else {
  console.log('No new messages.');
}

// Update last check
lastCheck.lastCheck = timestamp;
const allProcessed = [...(lastCheck.processedPages || []), ...pages.map(p => p.id)];
lastCheck.processedPages = allProcessed.slice(-100);
fs.writeFileSync(lastCheckPath, JSON.stringify(lastCheck, null, 2));
console.log('Updated lastCheck to', timestamp);