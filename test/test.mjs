import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { initState } from '../src/config.mjs';
import { ensureIdentity } from '../src/keys.mjs';
import { createDataItem, payloadText, verifyDataItem } from '../src/dataitem.mjs';
import { LocalTransport } from '../src/transport.mjs';
import {
  buildArticleTags,
  buildAttestationTags,
  contentHash,
  deriveKey,
  slugify,
  tagsToObject,
  validateArticleKey,
  validateConfidence,
  validateKind,
  validateOpinion
} from '../src/tags.mjs';

function run(args, options = {}) {
  return spawnSync(process.execPath, ['scripts/cli.mjs', ...args], {
    encoding: 'utf8',
    env: { ...process.env, ...options.env }
  });
}

let result = run(['--help']);
assert.equal(result.status, 0);
for (const command of ['init', 'probe-hyperbeam', 'publish', 'import-wikipedia', 'query', 'get', 'attest', 'consensus', 'sync']) {
  assert.match(result.stdout, new RegExp(command));
}

result = run(['publish', '--help']);
assert.equal(result.status, 0);
assert.match(result.stdout, /Usage: permabrain publish/);

result = run(['nope']);
assert.notEqual(result.status, 0);
assert.match(result.stderr, /Unknown command: nope/);

const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'permabrain-test-'));
result = run(['init', '--json'], { env: { PERMABRAIN_HOME: tempHome } });
assert.equal(result.status, 0, result.stderr);
const initJson = JSON.parse(result.stdout);
assert.equal(initJson.home, tempHome);
assert.equal(initJson.config, 'created');
assert.equal(initJson.identity, 'created');
assert.match(initJson.agentId, /^arweave:/);
assert.equal(initJson.keyType, 'arweave-rsa4096');
assert.equal(initJson.identityInit, 'created');
assert.ok(initJson.identityInitEvent.endsWith('identity-init.json'));
assert.ok(fs.existsSync(path.join(tempHome, 'config.json')));
assert.ok(fs.existsSync(path.join(tempHome, 'keys.json')));
assert.ok(fs.existsSync(path.join(tempHome, 'identity-init.json')));
const identityInit = JSON.parse(fs.readFileSync(path.join(tempHome, 'identity-init.json'), 'utf8'));
assert.equal(identityInit.type, 'identity-init');
assert.equal(identityInit.agentId, initJson.agentId);
assert.equal(identityInit.keyType, 'arweave-rsa4096');
assert.equal(identityInit.visibility, 'public');
assert.ok(!JSON.stringify(identityInit).includes('PRIVATE KEY'));
assert.ok(!JSON.stringify(identityInit).includes('"jwk"'));
assert.ok(fs.existsSync(path.join(tempHome, 'cache', 'pages')));
assert.ok(fs.existsSync(path.join(tempHome, 'cache', 'objects')));
assert.ok(fs.existsSync(path.join(tempHome, 'logs')));
assert.doesNotMatch(result.stdout, /PRIVATE KEY/);
const firstKeys = fs.readFileSync(path.join(tempHome, 'keys.json'), 'utf8');

result = run(['init', '--json'], { env: { PERMABRAIN_HOME: tempHome } });
assert.equal(result.status, 0, result.stderr);
const secondJson = JSON.parse(result.stdout);
assert.equal(secondJson.config, 'existing');
assert.equal(secondJson.identity, 'existing');
assert.equal(secondJson.identityInit, 'existing');
assert.equal(fs.readFileSync(path.join(tempHome, 'keys.json'), 'utf8'), firstKeys);

if (process.platform !== 'win32') {
  const mode = fs.statSync(path.join(tempHome, 'keys.json')).mode & 0o777;
  assert.equal(mode, 0o600);
}

assert.equal(slugify('Ada Lovelace'), 'ada-lovelace');
assert.equal(slugify('Artificial intelligence'), 'artificial-intelligence');
assert.equal(deriveKey({ kind: 'person', title: 'Ada Lovelace' }), 'person/ada-lovelace');
assert.equal(validateKind('subject'), 'subject');
assert.throws(() => validateKind('private'), /Invalid Article-Kind/);
assert.equal(validateArticleKey('person/ada-lovelace'), 'person/ada-lovelace');
assert.throws(() => validateArticleKey('bad/thing'), /Invalid Article-Kind/);
assert.equal(validateOpinion('valid'), 'valid');
assert.throws(() => validateOpinion('maybe'), /Invalid Attestation-Opinion/);
assert.equal(validateConfidence('0.95'), 0.95);
assert.throws(() => validateConfidence('1.5'), /Invalid Attestation-Confidence/);
assert.equal(contentHash('hello'), 'sha256:2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824');

const articleTagsArray = buildArticleTags({
  key: 'person/ada-lovelace',
  kind: 'person',
  title: 'Ada Lovelace',
  topic: 'computing',
  sourceName: 'Wikipedia',
  sourceUrl: 'https://en.wikipedia.org/wiki/Ada_Lovelace',
  sourceLicense: 'CC BY-SA',
  content: '# Ada Lovelace',
  agentId: 'agent:test',
  now: '2026-01-01T00:00:00.000Z'
});
const articleTags = tagsToObject(articleTagsArray);
for (const required of ['App-Name', 'App-Version', 'PermaBrain-Type', 'Article-Key', 'Article-Kind', 'Article-Title', 'Article-Slug', 'Article-Topic', 'Article-Language', 'Article-Version', 'Article-Source-Name', 'Article-Source-Url', 'Article-Source-License', 'Article-Content-Hash', 'Article-Published-At', 'Article-Updated-At', 'Author-Agent-Id', 'Visibility']) {
  assert.ok(articleTags[required], `missing article tag ${required}`);
}
assert.equal(articleTags['PermaBrain-Type'], 'article');
assert.equal(articleTags['Article-Key'], 'person/ada-lovelace');
assert.equal(articleTags['Article-Version'], '1');

const attestationTags = tagsToObject(buildAttestationTags({
  targetId: 'dataitem:1',
  targetKey: 'person/ada-lovelace',
  opinion: 'valid',
  confidence: 0.95,
  reason: 'Source backed',
  agentId: 'agent:test',
  now: '2026-01-01T00:00:00.000Z'
}));
for (const required of ['App-Name', 'App-Version', 'PermaBrain-Type', 'Attestation-Target-Id', 'Attestation-Target-Key', 'Attestation-Opinion', 'Attestation-Confidence', 'Attestation-Reason', 'Attestation-Agent-Id', 'Attestation-Created-At']) {
  assert.ok(attestationTags[required], `missing attestation tag ${required}`);
}
assert.equal(attestationTags['PermaBrain-Type'], 'attestation');
assert.equal(attestationTags['Attestation-Opinion'], 'valid');

const localHome = fs.mkdtempSync(path.join(os.tmpdir(), 'permabrain-local-'));
const { home } = initState({ env: { ...process.env, PERMABRAIN_HOME: localHome, PERMABRAIN_TRANSPORT: 'local' } });
const { identity } = await ensureIdentity(home);
const item = await createDataItem({ payload: '# Ada Lovelace', tags: articleTagsArray, identity });
assert.match(item.id, /^[A-Za-z0-9_-]+$/);
assert.equal(await verifyDataItem(item), true);
assert.equal(payloadText(item), '# Ada Lovelace');
const transport = new LocalTransport(home);
await transport.uploadDataItem(item);
const fetched = await transport.fetchDataItem(item.id);
assert.equal(fetched.id, item.id);
assert.equal(payloadText(fetched), '# Ada Lovelace');
const queried = await transport.queryByTags({ 'PermaBrain-Type': 'article', 'Article-Key': 'person/ada-lovelace' });
assert.equal(queried.length, 1);
assert.equal(queried[0].id, item.id);

result = run(['probe-hyperbeam', '--url', 'http://127.0.0.1:9', '--json']);
assert.equal(result.status, 0, result.stderr);
const probe = JSON.parse(result.stdout);
assert.equal(probe.ok, false);

const cliHome = fs.mkdtempSync(path.join(os.tmpdir(), 'permabrain-cli-'));
const cliEnv = { PERMABRAIN_HOME: cliHome, PERMABRAIN_TRANSPORT: 'local' };
result = run(['init', '--json'], { env: cliEnv });
assert.equal(result.status, 0, result.stderr);
const articleFile = path.join(cliHome, 'ada.md');
fs.writeFileSync(articleFile, '# Ada Lovelace\n\nFirst programmer.\n');
result = run(['publish', articleFile, '--kind', 'person', '--topic', 'computing', '--title', 'Ada Lovelace', '--source-url', 'https://en.wikipedia.org/wiki/Ada_Lovelace', '--json'], { env: cliEnv });
assert.equal(result.status, 0, result.stderr);
const published = JSON.parse(result.stdout);
assert.equal(published.key, 'person/ada-lovelace');
assert.equal(published.version, 1);
assert.match(published.id, /^[A-Za-z0-9_-]+$/);

fs.writeFileSync(articleFile, '# Ada Lovelace\n\nUpdated article.\n');
result = run(['publish', articleFile, '--kind', 'person', '--topic', 'computing', '--title', 'Ada Lovelace', '--source-url', 'https://en.wikipedia.org/wiki/Ada_Lovelace', '--json'], { env: cliEnv });
assert.equal(result.status, 0, result.stderr);
const republished = JSON.parse(result.stdout);
assert.equal(republished.version, 2);
assert.equal(republished.previousId, published.id);

result = run(['query', '--topic', 'computing', '--json'], { env: cliEnv });
assert.equal(result.status, 0, result.stderr);
const queryResult = JSON.parse(result.stdout);
assert.equal(queryResult.length, 1);
assert.equal(queryResult[0].key, 'person/ada-lovelace');
assert.equal(queryResult[0].version, 2);

result = run(['get', 'person/ada-lovelace'], { env: cliEnv });
assert.equal(result.status, 0, result.stderr);
assert.match(result.stdout, /Updated article/);

result = run(['sync', '--json'], { env: cliEnv });
assert.equal(result.status, 0, result.stderr);
let syncIndex = JSON.parse(result.stdout);
assert.equal(syncIndex.articles['person/ada-lovelace'].version, 2);
assert.ok(fs.existsSync(path.join(cliHome, 'cache', 'index.json')));

const fixtureDir = path.join(cliHome, 'wiki-fixtures');
fs.mkdirSync(fixtureDir);
fs.writeFileSync(path.join(fixtureDir, 'artificial-intelligence.json'), JSON.stringify({
  title: 'Artificial intelligence',
  extract: 'Artificial intelligence is intelligence exhibited by machines.',
  content_urls: { desktop: { page: 'https://en.wikipedia.org/wiki/Artificial_intelligence' } }
}));
const wikiEnv = { ...cliEnv, PERMABRAIN_WIKIPEDIA_FIXTURE_DIR: fixtureDir };
result = run(['import-wikipedia', 'Artificial intelligence', '--kind', 'subject', '--topic', 'ai', '--json'], { env: wikiEnv });
assert.equal(result.status, 0, result.stderr);
const imported = JSON.parse(result.stdout);
assert.equal(imported.key, 'subject/artificial-intelligence');
assert.equal(imported.sourceName, 'Wikipedia');

result = run(['query', '--kind', 'subject', '--json'], { env: wikiEnv });
assert.equal(result.status, 0, result.stderr);
assert.equal(JSON.parse(result.stdout)[0].key, 'subject/artificial-intelligence');

result = run(['attest', 'person/ada-lovelace', '--valid', '--confidence', '0.95', '--reason', 'Source backed', '--json'], { env: cliEnv });
assert.equal(result.status, 0, result.stderr);
const attested = JSON.parse(result.stdout);
assert.equal(attested.targetKey, 'person/ada-lovelace');
assert.equal(attested.opinion, 'valid');
assert.equal(attested.confidence, 0.95);

result = run(['attest', 'person/ada-lovelace', '--partially-valid', '--confidence', '0.8', '--reason', 'Good summary but short', '--json'], { env: cliEnv });
assert.equal(result.status, 0, result.stderr);

result = run(['consensus', 'person/ada-lovelace', '--json'], { env: cliEnv });
assert.equal(result.status, 0, result.stderr);
const consensus = JSON.parse(result.stdout);
assert.equal(consensus.totalAttestations, 2);
assert.equal(consensus.opinionCounts.valid, 1);
assert.equal(consensus.opinionCounts['partially-valid'], 1);
assert.equal(consensus.score, 0.675);

result = run(['sync', '--json'], { env: cliEnv });
assert.equal(result.status, 0, result.stderr);
syncIndex = JSON.parse(result.stdout);
assert.ok(syncIndex.articles['person/ada-lovelace']);
assert.ok(syncIndex.articles['subject/artificial-intelligence']);
assert.equal(syncIndex.attestations['person/ada-lovelace'].length, 2);

const edHome = fs.mkdtempSync(path.join(os.tmpdir(), 'permabrain-ed25519-'));
result = run(['init', '--key-type', 'ed25519', '--json'], { env: { PERMABRAIN_HOME: edHome } });
assert.equal(result.status, 0, result.stderr);
const edInit = JSON.parse(result.stdout);
assert.equal(edInit.keyType, 'ed25519');
assert.match(edInit.agentId, /^ed25519:/);
const edIdentity = JSON.parse(fs.readFileSync(path.join(edHome, 'keys.json'), 'utf8'));
const edTags = buildArticleTags({
  key: 'subject/ed25519',
  kind: 'subject',
  title: 'Ed25519',
  topic: 'crypto',
  sourceName: 'test',
  sourceUrl: 'https://example.invalid/ed25519',
  sourceLicense: 'test',
  content: 'ed25519 payload',
  agentId: edIdentity.agentId
});
const edItem = await createDataItem({ payload: 'ed25519 payload', tags: edTags, identity: edIdentity });
assert.equal(await verifyDataItem(edItem), true);
assert.equal(payloadText(edItem), 'ed25519 payload');

console.log('unit tests passed');
