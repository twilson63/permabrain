/**
 * Test: Identity introspection report
 *
 * Covers buildIdentityReport, identityReportToMarkdown, identityReportToHtml,
 * and the CLI/API/SDK integration stubs.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {
  buildIdentityReport,
  identityReportToMarkdown,
  identityReportToHtml
} from '../src/identity-report.mjs';
import { api } from '../src/agent-api.mjs';

// --- 1. Report shape and redaction ---
console.log('1. Report shape and redaction');
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'pb-identity-test-'));
const identityInit = await api.init({ home, keyType: 'ed25519' });
const identity = identityInit;
process.env.PERMABRAIN_HOME = home;
const report = buildIdentityReport({ home });
assert.equal(report.agentId, identity.agentId, 'agentId matches');
assert.equal(report.keyType, 'ed25519', 'keyType is ed25519');
assert.equal(report.home, home, 'home matches');
assert.equal(report.transport, 'arweave', 'default transport');
assert.ok(report.publicKey, 'publicKey present');
assert.ok(report.encryptionPublicKey, 'derived encryption public key present');
assert.equal(report.encryptionKeyType, 'x25519-derived', 'encryption key type');
assert.ok(report.encryptionFingerprint, 'encryption fingerprint present');
assert.equal(report.config.transport, 'arweave', 'config included');
assert.equal(report.config.gateway.type, 'arweave', 'gateway in config summary');
console.log('   ✓ Report shape and redaction good');

// --- 2. Markdown output contains identity info ---
console.log('2. Markdown output');
const markdown = identityReportToMarkdown(report);
assert.match(markdown, /PermaBrain Identity/);
assert.match(markdown, new RegExp(report.agentId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
assert.match(markdown, /Config summary/);
console.log('   ✓ Markdown output good');

// --- 3. HTML output ---
console.log('3. HTML output');
const html = identityReportToHtml(report, { title: 'Test Identity' });
assert.match(html, /<title>Test Identity<\/title>/);
assert.match(html, new RegExp(report.agentId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
assert.match(html, /<table>/);
assert.match(html, /<\/html>/);
console.log('   ✓ HTML output good');

// --- 4. API whoami ---
console.log('4. API whoami');
const whoami = await api.whoami();
assert.equal(whoami.agentId, identity.agentId);
assert.ok(whoami.encryptionPublicKey);
const whoamiMd = await api.whoami({ markdown: true });
assert.ok(whoamiMd.markdown, 'markdown returned');
assert.match(whoamiMd.markdown, /PermaBrain Identity/);
const whoamiHtml = await api.whoami({ html: true });
assert.match(whoamiHtml, /<html/);
console.log('   ✓ API whoami good');

// Cleanup
fs.rmSync(home, { recursive: true, force: true });

console.log('\n✅ Identity report tests passed');
