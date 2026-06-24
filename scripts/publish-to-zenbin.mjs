import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const [, , file, title, pageId] = process.argv;
if (!file || !title) {
  console.error('Usage: node scripts/publish-to-zenbin.mjs <file.html|md> "<title>" [<page-id>]');
  process.exit(1);
}

const keyFile = process.env.ZENBIN_KEY_FILE || '.zenbin-key.json';
if (!fs.existsSync(keyFile)) {
  console.error(`ZenBin key file not found: ${keyFile}`);
  process.exit(1);
}

const { keyId, privateJwk } = JSON.parse(fs.readFileSync(keyFile, 'utf8'));
const content = fs.readFileSync(file, 'utf8');
const ext = path.extname(file).toLowerCase();

const bodyFields = { title };
if (pageId) bodyFields.pageId = pageId;
if (ext === '.html') bodyFields.html = content;
else if (ext === '.md' || ext === '.markdown') bodyFields.markdown = content;
else {
  console.error('Unsupported file type. Use .html or .md');
  process.exit(1);
}

const body = JSON.stringify(bodyFields);
const bodyBuffer = Buffer.from(body, 'utf8');

// ZenBin uses standard base64 inside the :...: wrapper for Content-Digest
const digestValue = crypto.createHash('sha256').update(bodyBuffer).digest('base64');
const contentDigest = `sha-256=:${digestValue}:`;

const timestamp = new Date().toISOString();
const nonce = crypto.randomUUID();
const pathName = pageId ? `/v1/pages/${pageId}` : '/v1/pages';
const canonical = `POST\n${pathName}\n${timestamp}\n${nonce}\n${contentDigest}`;

const privateKey = crypto.createPrivateKey({ key: privateJwk, format: 'jwk' });
const signature = crypto.sign(null, Buffer.from(canonical, 'utf8'), privateKey);
// ZenBin agent.md shows base64 with manual URL-safe conversion, not base64url directly
const signatureBase64Url = signature.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

const url = `https://zenbin.org${pathName}`;
const response = await fetch(url, {
  method: 'POST',
  headers: {
    'content-type': 'application/json',
    'x-zenbin-key-id': keyId,
    'x-zenbin-timestamp': timestamp,
    'x-zenbin-nonce': nonce,
    'content-digest': contentDigest,
    'x-zenbin-signature': `:${signatureBase64Url}:`,
  },
  body,
});

const responseText = await response.text();
let responseBody;
try { responseBody = JSON.parse(responseText); } catch { responseBody = responseText; }

if (!response.ok) {
  throw new Error(`ZenBin publish failed: ${response.status} ${response.statusText} ${JSON.stringify(responseBody)}`);
}

console.log('Published:', responseBody.url || `https://zenbin.org/p/${responseBody.id}`);
console.log('Page ID:', responseBody.id);
console.log('Raw URL:', responseBody.raw_url);
