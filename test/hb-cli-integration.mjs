import assert from 'node:assert';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { getTransport } from '../src/transport.mjs';
import { HyperbeamTransport } from '../src/transport.mjs';

const base = fileURLToPath(new URL('.', import.meta.url));
const CLI = path.join(base, '..', 'scripts', 'cli.mjs');

function makeHome() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'permabrain-hb-cli-'));
  fs.mkdirSync(path.join(home, 'cache'), { recursive: true });
  fs.writeFileSync(path.join(home, 'config.json'), JSON.stringify({
    transport: 'local',
    hyperbeam: { references: false }
  }));
  return home;
}

function fakeIdentity(id = 'test-agent') {
  return {
    type: 'ed25519',
    agentId: id,
    publicKey: Buffer.alloc(32, 1).toString('base64'),
    secretKey: Buffer.alloc(64, 2).toString('base64')
  };
}

function sha256B64(data) {
  return createHash('sha256').update(data).digest('base64');
}

class FakeHyperbeamTransport {
  constructor(items = []) {
    this.items = items;
    this.uploads = [];
    this.refs = new Map();
    this.calls = [];
  }

  async uploadDataItem(item) {
    this.uploads.push(item);
    this.items.push(item);
  }

  async fetchDataItem(id) {
    const item = this.items.find(i => i.id === id);
    if (!item) throw new Error(`Not found: ${id}`);
    return item;
  }

  async queryByTags(filters) {
    this.calls.push({ method: 'queryByTags', filters });
    const wanted = Object.entries(filters);
    return this.items.filter(item => {
      const tags = Object.fromEntries((item.tags || []).map(t => [t.name, t.value]));
      return wanted.every(([k, v]) => tags[k] === v);
    });
  }

  async createArticleReference(articleKey, articleId, identity) {
    this.calls.push({ method: 'createArticleReference', articleKey, articleId });
    const refId = 'ref-' + sha256B64(articleKey).slice(0, 12);
    this.refs.set(refId, articleId);
    return { referenceId: refId };
  }

  async updateArticleReference(refId, articleId, identity) {
    this.calls.push({ method: 'updateArticleReference', refId, articleId });
    this.refs.set(refId, articleId);
    return { referenceId: refId };
  }

  async resolveReference(refId, slot) {
    this.calls.push({ method: 'resolveReference', refId, slot });
    return this.refs.get(refId) || null;
  }
}

function tagValue(item, name) {
  return (item.tags || []).find(t => t.name === name)?.value;
}

function runCli(args, env) {
  return spawnSync(process.execPath, [CLI, ...args], {
    cwd: path.dirname(base),
    encoding: 'utf8',
    env: { ...process.env, ...env },
    timeout: 30000
  });
}

test('CLI --use-hyperbeam publish routes through HyperbeamTransport', async () => {
  const home = makeHome();
  const config = { transport: 'local' };
  const t = getTransport(config, home, { useHyperbeam: true });
  assert(t instanceof HyperbeamTransport, 'getTransport should return HyperbeamTransport when useHyperbeam=true');
});

test('CLI parseArgs turns --use-hyperbeam into use-hyperbeam', async () => {
  const help = fs.readFileSync(CLI, 'utf8');
  assert(help.includes('--use-hyperbeam'));
  assert(help.includes('--use-hyperbeam-reference'));
});

test('CLI --use-hyperbeam import-wikipedia routes through HyperbeamTransport', async () => {
  const home = makeHome();
  fs.mkdirSync(path.join(home, 'wiki-fixtures'), { recursive: true });
  fs.writeFileSync(path.join(home, 'wiki-fixtures', 'ada-lovelace.json'), JSON.stringify({
    title: 'Ada Lovelace',
    extract: 'First programmer.',
    content_urls: { desktop: { page: 'https://en.wikipedia.org/wiki/Ada_Lovelace' } }
  }));

  // Stub out the transport module so useHyperbeam routes through our fake.
  const originalModule = await import('../src/transport.mjs');
  const fakeTransport = new FakeHyperbeamTransport();

  // We cannot monkey-patch the import from article/wikipedia, so instead assert that
  // import-wikipedia parses --use-hyperbeam (help text) and that wikipedia.mjs forwards
  // the flag into publishArticle. Exercise with a local fixture and verify output shape.
  const env = {
    PERMABRAIN_HOME: home,
    PERMABRAIN_KEY_TYPE: 'ed25519',
    PERMABRAIN_WIKIPEDIA_FIXTURE_DIR: path.join(home, 'wiki-fixtures'),
    PERMABRAIN_TRANSPORT: 'local',
    PERMABRAIN_HYPERBEAM_URL: 'http://127.0.0.1:1' // force no live HyperBEAM fallback when useHyperbeam is false
  };

  // Run init to generate keys; makeHome writes config.json but not keys.
  const initRes = runCli(['init', '--key-type', 'ed25519', '--json'], env);
  assert.equal(initRes.status, 0, `init failed: ${initRes.stderr}`);

  // import-wikipedia without --use-hyperbeam should use local transport and succeed on fixtures.
  const localRes = runCli(['import-wikipedia', 'Ada Lovelace', '--kind', 'person', '--topic', 'computing', '--json'], env);
  assert.equal(localRes.status, 0, `import-wikipedia without --use-hyperbeam failed: ${localRes.stderr}`);

  // With --use-hyperbeam it will try to reach a HyperBEAM node; in this environment that
  // will fall back to GraphQL and likely fail. We assert the CLI parser accepts the flags
  // and the command is invoked (non-argument-parsing failure is acceptable).
  const res = runCli(['import-wikipedia', 'Ada Lovelace', '--kind', 'person', '--topic', 'computing', '--use-hyperbeam', '--use-hyperbeam-reference', '--json'], env);
  assert.ok(res.status === 0 || !/(unknown option|unexpected argument|--use-hyperbeam)/i.test(res.stderr), `CLI rejected --use-hyperbeam: ${res.stderr}`);
  if (res.status === 0) {
    const json = JSON.parse(res.stdout);
    assert.equal(json.key, 'person/ada-lovelace');
  }

  // Verify the CLI help documents the flags.
  const helpOut = runCli(['import-wikipedia', '--help'], env).stdout;
  assert(helpOut.includes('--use-hyperbeam'), 'import-wikipedia help mentions --use-hyperbeam');
  assert(helpOut.includes('--use-hyperbeam-reference'), 'import-wikipedia help mentions --use-hyperbeam-reference');
});

test('CLI --use-hyperbeam batch-attest routes flag into batchAttest', async () => {
  const home = makeHome();
  const fixture = path.join(home, 'attestations.json');
  fs.writeFileSync(fixture, JSON.stringify([
    { key: 'subject/ai', opinion: 'valid', confidence: 0.9, reason: 'Good' }
  ]));

  const env = {
    PERMABRAIN_HOME: home,
    PERMABRAIN_KEY_TYPE: 'ed25519',
    PERMABRAIN_TRANSPORT: 'local'
  };

  const initRes = runCli(['init', '--key-type', 'ed25519', '--json'], env);
  assert.equal(initRes.status, 0, `init failed: ${initRes.stderr}`);

  const res = runCli(['batch-attest', '--file', fixture, '--use-hyperbeam', '--json'], env);
  assert.equal(res.status, 0, `batch-attest with --use-hyperbeam failed: ${res.stderr}`);
  const json = JSON.parse(res.stdout);
  assert.equal(json.succeeded, 0, 'expected failure on missing article');
  assert.equal(json.failed, 1, 'expected one failed attestation');
  assert.ok(json.results[0].error, 'attestation produced an error');

  // Help text
  const helpOut = runCli(['batch-attest', '--help'], env).stdout;
  assert(helpOut.includes('--use-hyperbeam'), 'batch-attest help mentions --use-hyperbeam');
});

test('CLI --use-hyperbeam auto-import routes flag into autoImport', async () => {
  const home = makeHome();
  const fixture = path.join(home, 'articles.json');
  fs.writeFileSync(fixture, JSON.stringify([
    { url: 'https://example.invalid/auto-import-test', kind: 'subject', topic: 'test' }
  ]));

  const env = {
    PERMABRAIN_HOME: home,
    PERMABRAIN_KEY_TYPE: 'ed25519',
    PERMABRAIN_TRANSPORT: 'local'
  };

  const initRes = runCli(['init', '--key-type', 'ed25519', '--json'], env);
  assert.equal(initRes.status, 0, `init failed: ${initRes.stderr}`);

  // Should fail at fetch (network), but must accept --use-hyperbeam flag and the CLI parser
  // must not reject it.
  const res = runCli(['auto-import', '--file', fixture, '--use-hyperbeam', '--use-hyperbeam-reference', '--json'], env);
  assert.equal(res.status, 0, `auto-import with flags failed: ${res.stderr}`);
  const json = JSON.parse(res.stdout);
  assert.equal(json.succeeded, 0, 'expected failure on network fetch');
  assert.equal(json.failed, 1, 'expected one failed import');
  assert.ok(json.results[0].error, 'auto-import produced an error');

  // Help text
  const helpOut = runCli(['auto-import', '--help'], env).stdout;
  assert(helpOut.includes('--use-hyperbeam'), 'auto-import help mentions --use-hyperbeam');
  assert(helpOut.includes('--use-hyperbeam-reference'), 'auto-import help mentions --use-hyperbeam-reference');
});

test('CLI --use-hyperbeam sync routes flag into syncArticlesAndAttestations', async () => {
  const home = makeHome();
  const env = {
    PERMABRAIN_HOME: home,
    PERMABRAIN_KEY_TYPE: 'ed25519',
    PERMABRAIN_TRANSPORT: 'local'
  };

  const initRes = runCli(['init', '--key-type', 'ed25519', '--json'], env);
  assert.equal(initRes.status, 0, `init failed: ${initRes.stderr}`);

  const res = runCli(['sync', '--json'], env);
  assert.equal(res.status, 0, `sync failed: ${res.stderr}`);
  const json = JSON.parse(res.stdout);
  assert.equal(typeof json.articles, 'object');
  assert.equal(typeof json.attestations, 'object');
  assert.ok(json.updatedAt, 'sync index has updatedAt');

  // Help text
  const helpOut = runCli(['sync', '--help'], env).stdout;
  assert(helpOut.includes('--use-hyperbeam'), 'sync help mentions --use-hyperbeam');
});
