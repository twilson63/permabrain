/**
 * Test: HTTP client SDK meta endpoints (version, identity, release notes).
 *
 * Covers client.version(), client.whoami(), client.whoamiMarkdown(),
 * client.whoamiHTML(), client.releaseNotes(), and client.releaseNotesMarkdown()
 * against a live permabrain serve instance.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createClient } from '../src/client.mjs';
import { startServer, stopServer } from '../src/serve.mjs';
import { api } from '../src/agent-api.mjs';
import { generateApiKey } from '../src/auth.mjs';

const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'permabrain-client-meta-'));
process.env.PERMABRAIN_HOME = tmpHome;
process.env.PERMABRAIN_TRANSPORT = 'local';

console.log('0. initialize identity before starting server');
await api.init({ home: tmpHome, transport: 'local', keyType: 'ed25519' });
console.log('   ✓ identity initialized');

const apiKey = generateApiKey();
const { server, port } = await startServer({ home: tmpHome, port: 0, apiKey });
const client = createClient({ baseUrl: `http://localhost:${port}`, apiKey });

console.log('1. client.version() returns package metadata');
const version = await client.version();
assert.equal(version.name, 'permabrain', 'version name is permabrain');
assert.ok(version.version, 'version string present');
assert.match(version.version, /^\d+\.\d+\.\d+/, 'version is semver-like');
console.log('   ✓ client.version()');

console.log('2. client.whoami() returns identity report');
const whoami = await client.whoami();
assert.ok(whoami.agentId, 'whoami has agentId');
assert.equal(whoami.home, tmpHome, 'whoami home matches');
assert.equal(whoami.transport, 'local', 'whoami transport local');
assert.ok(whoami.publicKey, 'whoami publicKey present');
assert.ok(whoami.encryptionPublicKey, 'whoami encryptionPublicKey present');
console.log('   ✓ client.whoami()');

console.log('3. client.whoamiMarkdown() returns markdown');
const md = await client.whoamiMarkdown();
assert.ok(typeof md === 'string', 'markdown is string');
assert.match(md, /PermaBrain Identity/);
assert.match(md, new RegExp(whoami.agentId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
console.log('   ✓ client.whoamiMarkdown()');

console.log('4. client.whoamiHTML() returns HTML');
const html = await client.whoamiHTML();
assert.ok(typeof html === 'string', 'html is string');
assert.match(html, /<html/);
assert.match(html, /PermaBrain Identity/);
console.log('   ✓ client.whoamiHTML()');

console.log('5. client.releaseNotes() returns structured notes');
const notes = await client.releaseNotes({ unreleased: true });
assert.ok(notes.markdown, 'release notes markdown present');
assert.ok(notes.json, 'release notes json present');
assert.ok(notes.release, 'release notes release present');
assert.match(notes.markdown, /\[Unreleased\]/);
console.log('   ✓ client.releaseNotes()');

console.log('6. client.releaseNotesMarkdown() returns markdown');
const notesMd = await client.releaseNotesMarkdown({ unreleased: true });
assert.ok(typeof notesMd === 'string', 'release notes markdown is string');
assert.match(notesMd, /\[Unreleased\]/);
console.log('   ✓ client.releaseNotesMarkdown()');

await stopServer(server);

api._home = undefined;
api._identity = undefined;
api._config = undefined;

fs.rmSync(tmpHome, { recursive: true, force: true });

console.log('\n✅ All client meta tests passed');
