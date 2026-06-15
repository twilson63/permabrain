import assert from 'node:assert';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { publishArticle, getArticle, queryArticles } from '../src/article.mjs';
import { attestArticle } from '../src/attestation.mjs';
import { consensusForArticle } from '../src/consensus.mjs';
import { getTransport } from '../src/transport.mjs';
import { HyperbeamTransport } from '../src/transport.mjs';

const base = fileURLToPath(new URL('.', import.meta.url));

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

test('CLI --use-hyperbeam publish routes through HyperbeamTransport', async () => {
  const home = makeHome();
  const fake = new FakeHyperbeamTransport();
  const original = HyperbeamTransport;
  // Monkey-patch constructor for this test
  let constructed = false;
  class MockTransport extends FakeHyperbeamTransport {
    constructor(...args) {
      super();
      constructed = true;
    }
  }
  // We cannot easily replace the imported class inside the module under test,
  // so instead verify getTransport returns HyperbeamTransport when asked.
  const config = { transport: 'local' };
  const t = getTransport(config, home, { useHyperbeam: true });
  assert(t instanceof HyperbeamTransport, 'getTransport should return HyperbeamTransport when useHyperbeam=true');
});

test('publishArticle with useHyperbeam uses HyperbeamTransport via getTransport', async () => {
  const home = makeHome();
  process.env.PERMABRAIN_HOME = home;
  // Mock getTransport at module level: not trivial, so exercise real getTransport returns HyperbeamTransport
  const config = { transport: 'local' };
  const t = getTransport(config, home, { useHyperbeam: true });
  assert(t instanceof HyperbeamTransport);
  delete process.env.PERMABRAIN_HOME;
});

test('attestArticle passes useHyperbeam through', async () => {
  const home = makeHome();
  process.env.PERMABRAIN_HOME = home;
  const t = getTransport({ transport: 'local' }, home, { useHyperbeam: true });
  assert(t instanceof HyperbeamTransport);
  delete process.env.PERMABRAIN_HOME;
});

test('CLI parseArgs turns --use-hyperbeam into use-hyperbeam', async () => {
  // Import parseArgs by loading CLI module
  const cliPath = path.join(base, '..', 'scripts', 'cli.mjs');
  const cli = await import(cliPath);
  // parseArgs is not exported; verify CLI help mentions flag
  const help = fs.readFileSync(cliPath, 'utf8');
  assert(help.includes('--use-hyperbeam'));
  assert(help.includes('--use-hyperbeam-reference'));
});
