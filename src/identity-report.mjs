import { loadIdentity, publicIdentity } from './keys.mjs';
import { deriveEncryptionKeyFromEd25519 } from './crypto.mjs';
import { loadConfig, defaultConfig, getHome } from './config.mjs';

/**
 * Build a local identity introspection report.
 *
 * Includes the public signing identity, derived encryption public key
 * (ed25519 identities only), home directory, transport preference, and a
 * redacted config summary. Safe to print or return over HTTP.
 *
 * @param {Object} [opts]
 * @param {string} [opts.home]
 * @param {Object} [opts.config]
 * @returns {{agentId: string, keyType: string, publicKey?: string, encryptionPublicKey?: string, encryptionFingerprint?: string, home: string, transport: string, hyperbeamUrl?: string, config: Object, createdAt?: string}}
 */
export function buildIdentityReport(opts = {}) {
  const home = opts.home || getHome();
  const config = opts.config || loadConfig(home);
  const identity = loadIdentity(home);
  const publicId = publicIdentity(identity);

  const report = {
    agentId: publicId.agentId,
    keyType: publicId.type,
    publicKey: publicId.publicKey || undefined,
    home,
    transport: config.transport || defaultConfig().transport || 'local',
    hyperbeamUrl: config.hyperbeamUrl || undefined,
    config: redactConfig(config),
    createdAt: publicId.createdAt
  };

  if (identity.type === 'ed25519' && identity.secretKey) {
    try {
      const edSeed = Buffer.from(identity.secretKey, 'base64url');
      const derived = deriveEncryptionKeyFromEd25519(edSeed);
      report.encryptionPublicKey = derived.publicKey;
      report.encryptionFingerprint = derived.fingerprint;
      report.encryptionKeyType = 'x25519-derived';
    } catch {
      // Leave encryption fields absent if derivation fails
    }
  }

  return report;
}

function redactConfig(config) {
  const clone = { ...config };
  const secretKeys = ['apiKey', 'jwk', 'privateJwk', 'secretKey', 'seed', 'encryptionSeed', 'passphrase'];
  for (const key of Object.keys(clone)) {
    if (secretKeys.some(s => key.toLowerCase().includes(s))) {
      clone[key] = '<redacted>';
    }
  }
  return clone;
}

/**
 * Render an identity report as markdown.
 *
 * @param {Object} report
 * @returns {string}
 */
export function identityReportToMarkdown(report) {
  const lines = [
    '# PermaBrain Identity',
    '',
    `- **Agent ID:** ${report.agentId}`,
    `- **Key type:** ${report.keyType}`,
    `- **Home:** ${report.home}`,
    `- **Transport:** ${report.transport}`
  ];
  if (report.hyperbeamUrl) lines.push(`- **HyperBEAM URL:** ${report.hyperbeamUrl}`);
  if (report.publicKey) lines.push(`- **Public key:** \`${report.publicKey}\``);
  if (report.encryptionPublicKey) {
    lines.push(`- **Encryption key type:** ${report.encryptionKeyType || 'x25519'}`);
    lines.push(`- **Encryption public key:** \`${report.encryptionPublicKey}\``);
    lines.push(`- **Encryption fingerprint:** \`${report.encryptionFingerprint}\``);
  }
  if (report.createdAt) lines.push(`- **Created:** ${report.createdAt}`);
  lines.push('', '## Config summary', '', '```json', JSON.stringify(report.config, null, 2), '```', '');
  return lines.join('\n');
}

/**
 * Render an identity report as a compact HTML card.
 *
 * @param {Object} report
 * @param {Object} [opts]
 * @param {string} [opts.title]
 * @returns {string}
 */
export function identityReportToHtml(report, opts = {}) {
  const title = opts.title || 'PermaBrain Identity';
  const rows = [
    ['Agent ID', report.agentId],
    ['Key type', report.keyType],
    ['Home', report.home],
    ['Transport', report.transport]
  ];
  if (report.hyperbeamUrl) rows.push(['HyperBEAM URL', report.hyperbeamUrl]);
  if (report.publicKey) rows.push(['Public key', `<code>${escapeHtml(report.publicKey)}</code>`]);
  if (report.encryptionPublicKey) {
    rows.push(['Encryption key type', report.encryptionKeyType || 'x25519']);
    rows.push(['Encryption public key', `<code>${escapeHtml(report.encryptionPublicKey)}</code>`]);
    rows.push(['Encryption fingerprint', `<code>${escapeHtml(report.encryptionFingerprint)}</code>`]);
  }
  if (report.createdAt) rows.push(['Created', report.createdAt]);

  const body = rows.map(([k, v]) => `<tr><th>${escapeHtml(k)}</th><td>${v}</td></tr>`).join('\n');
  const configJson = escapeHtml(JSON.stringify(report.config, null, 2));

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>
body { font-family: system-ui, -apple-system, sans-serif; margin: 2rem; background: #0b0f19; color: #e2e8f0; }
table { border-collapse: collapse; width: 100%; max-width: 720px; margin-bottom: 1.5rem; }
th, td { text-align: left; padding: 0.5rem; border-bottom: 1px solid #334155; }
th { width: 40%; color: #94a3b8; }
code { word-break: break-all; font-size: 0.9em; }
pre { background: #1e293b; padding: 1rem; border-radius: 0.5rem; overflow: auto; }
h1 { font-size: 1.5rem; margin-bottom: 1rem; }
</style>
</head>
<body>
<h1>${escapeHtml(title)}</h1>
<table>
${body}
</table>
<h2>Config summary</h2>
<pre><code>${configJson}</code></pre>
</body>
</html>`;
}

function escapeHtml(text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
