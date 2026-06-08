import crypto from 'node:crypto';
import fs from 'node:fs';

const keyId = 'dev1-key-1779107912508';
const privateKeyJwk = { crv: 'Ed25519', d: 'uG4rsZfaMrp6OTQaWY9SyimcBLaUfi3R-FBcovTNuIQ', x: 'VNwCdReytqk_dtPgMOOTQn_wUaejDMTYjtC0ymPEhSg', kty: 'OKP' };

const markdown = fs.readFileSync('karpathy-llm-wiki.md', 'utf8');

const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Karpathy LLM Wiki Pattern — PermaBrain</title>
<script src="https://cdn.jsdelivr.net/npm/marked/marked.min.js"></script>
<style>
  :root { --bg: #0d1117; --surface: #161b22; --text: #e6edf3; --muted: #8b949e; --accent: #58a6ff; --border: #30363d; --quote: #f0883e; }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif; background: var(--bg); color: var(--text); line-height: 1.7; padding: 2rem 1rem; max-width: 800px; margin: 0 auto; }
  .header { border-bottom: 1px solid var(--border); padding-bottom: 1.5rem; margin-bottom: 2rem; }
  .header h1 { font-size: 2rem; font-weight: 700; margin-bottom: 0.5rem; }
  .header .meta { color: var(--muted); font-size: 0.9rem; }
  .header .meta a { color: var(--accent); text-decoration: none; }
  .header .badge { display: inline-block; background: #238636; color: white; padding: 0.15rem 0.6rem; border-radius: 12px; font-size: 0.75rem; margin-left: 0.5rem; }
  h1 { font-size: 1.6rem; margin: 2rem 0 0.75rem; color: var(--text); }
  h2 { font-size: 1.3rem; margin: 1.5rem 0 0.5rem; color: var(--text); border-bottom: 1px solid var(--border); padding-bottom: 0.3rem; }
  h3 { font-size: 1.1rem; margin: 1.2rem 0 0.4rem; color: var(--text); }
  p { margin-bottom: 1rem; }
  a { color: var(--accent); }
  blockquote { border-left: 3px solid var(--quote); padding: 0.75rem 1rem; margin: 1rem 0; background: rgba(240, 136, 62, 0.1); border-radius: 0 6px 6px 0; }
  blockquote p { margin-bottom: 0; }
  code { background: var(--surface); padding: 0.15rem 0.4rem; border-radius: 4px; font-size: 0.9em; }
  ul, ol { padding-left: 1.5rem; margin-bottom: 1rem; }
  li { margin-bottom: 0.3rem; }
  strong { color: #f0f6fc; }
  .footer { border-top: 1px solid var(--border); margin-top: 3rem; padding-top: 1.5rem; color: var(--muted); font-size: 0.85rem; }
  #content { display: none; }
  #rendered { }
</style>
</head>
<body>
<div class="header">
  <h1>Karpathy LLM Wiki Pattern</h1>
  <div class="meta">
    Published via <a href="https://github.com/twilson63/permabrain">PermaBrain</a> · Subject · AI
    <span class="badge">✓ Attested</span>
    <br>Source: <a href="https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f">Andrej Karpathy</a> · 2026-06-06
  </div>
</div>
<div id="rendered"></div>
<textarea id="content">${markdown.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}</textarea>
<div class="footer">
  PermaBrain — public, permanent, signed knowledge · <a href="https://zenbin.org/p/karpathy-llm-wiki-pattern/md">View raw markdown</a>
</div>
<script>
document.getElementById('rendered').innerHTML = marked.parse(document.getElementById('content').value);
</script>
</body>
</html>`;

async function main() {
  const privateKey = await crypto.subtle.importKey('jwk', privateKeyJwk, { name: 'Ed25519' }, false, ['sign']);

  const pageId = 'karpathy-llm-wiki-pattern';
  const body = JSON.stringify({ html, title: 'Karpathy LLM Wiki Pattern — PermaBrain' });
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