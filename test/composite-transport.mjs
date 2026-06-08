/**
 * Composite Transport Unit Tests
 *
 * Tests the CompositeTransport cascade logic:
 *   - Config → transport stack construction
 *   - Write operations go to Arweave first, then AO
 *   - Read operations cascade through transports
 *   - Fallback behavior when primary transport fails
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { initState } from '../src/config.mjs';
import { CompositeTransport } from '../src/composite-transport.mjs';
import { getTransport } from '../src/transport.mjs';
import { ensureIdentity } from '../src/keys.mjs';
import { createDataItem } from '../src/dataitem.mjs';
import { buildArticleTags } from '../src/tags.mjs';

// ============================================================================
// Transport stack construction
// ============================================================================

// Composite with AO + Arweave + local
const compositeConfig = {
  transport: 'composite',
  ao: { processId: 'test-process-123' },
  gateway: { graphqlUrl: 'https://arweave.net/graphql', dataUrl: 'https://arweave.net' },
  bundler: { uploadUrl: 'https://up.arweave.net/tx' }
};
const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'permabrain-composite-'));
initState({ env: { PERMABRAIN_HOME: tempHome } });

const composite = new CompositeTransport(compositeConfig, tempHome);
assert.equal(composite.transports.length, 3, 'AO + Arweave + local = 3 transports');
assert.equal(composite.transports[0].name, 'ao', 'AO is first');
assert.equal(composite.transports[1].name, 'arweave', 'Arweave is second');
assert.equal(composite.transports[2].name, 'local', 'Local is last');

console.log('✓ CompositeTransport with AO + Arweave + local');

// Composite without AO (no processId)
const noAoConfig = {
  transport: 'composite',
  gateway: { graphqlUrl: 'https://arweave.net/graphql', dataUrl: 'https://arweave.net' },
  bundler: { uploadUrl: 'https://up.arweave.net/tx' }
};
const noAo = new CompositeTransport(noAoConfig, tempHome);
assert.equal(noAo.transports.length, 2, 'Arweave + local = 2 transports');
assert.equal(noAo.transports[0].name, 'arweave');
assert.equal(noAo.transports[1].name, 'local');

console.log('✓ CompositeTransport without AO');

// Composite with only local
const localOnlyConfig = {
  transport: 'composite',
  gateway: {},
  bundler: {}
};
const localOnly = new CompositeTransport(localOnlyConfig, tempHome);
assert.equal(localOnly.transports.length, 1, 'local only = 1 transport');
assert.equal(localOnly.transports[0].name, 'local');

console.log('✓ CompositeTransport with only local');

// Composite without home (no local fallback)
const noHome = new CompositeTransport(compositeConfig, null);
assert.ok(noHome.transports.length >= 1, 'At least AO transport present');
assert.ok(!noHome.transports.find(t => t.name === 'local'), 'No local transport without home');

console.log('✓ CompositeTransport without home directory');

// ============================================================================
// writeTransport selection
// ============================================================================

// Prefer Arweave for writes
assert.ok(noAo.writeTransport, 'writeTransport exists');
// The writeTransport should be the ArweaveTransport instance
assert.equal(noAo.writeTransport.constructor.name, 'ArweaveTransport');

console.log('✓ writeTransport prefers Arweave');

// ============================================================================
// getTransport factory integration
// ============================================================================

const factoryTransport = getTransport(compositeConfig, tempHome);
assert.ok(factoryTransport instanceof CompositeTransport, 'getTransport returns CompositeTransport for transport: "composite"');

console.log('✓ getTransport factory returns CompositeTransport');

// ============================================================================
// Local-only operations (testable without network)
// ============================================================================

// Use local-only composite for actual read/write tests
const { identity } = await ensureIdentity(tempHome);
const articleTags = buildArticleTags({
  key: 'person/alan-turing',
  kind: 'person',
  title: 'Alan Turing',
  topic: 'computing',
  sourceName: 'Test',
  sourceUrl: 'https://example.com/turing',
  sourceLicense: 'test',
  content: '# Alan Turing\n\nFather of computer science.',
  agentId: identity.agentId
});
const item = await createDataItem({ payload: '# Alan Turing\n\nFather of computer science.', tags: articleTags, identity });

// Upload to local-only composite
const uploadResult = await localOnly.uploadDataItem(item);
assert.equal(uploadResult.id, item.id, 'Upload returns item ID');
assert.equal(uploadResult.status, 'stored-local', 'Upload stored locally');

console.log('✓ Local upload via CompositeTransport');

// Fetch from local
const fetched = await localOnly.fetchDataItem(item.id);
assert.equal(fetched.id, item.id, 'Fetched item matches');

console.log('✓ Local fetch via CompositeTransport');

// Fetch data
const data = await localOnly.fetchData(item.id);
assert.ok(data.toString().includes('Alan Turing'), 'Fetched data contains content');

console.log('✓ Local fetchData via CompositeTransport');

// Query by tags
const queried = await localOnly.queryByTags({ 'PermaBrain-Type': 'article', 'Article-Key': 'person/alan-turing' });
assert.equal(queried.length, 1, 'Query returns 1 result');
assert.equal(queried[0].id, item.id, 'Query result matches');

console.log('✓ Local queryByTags via CompositeTransport');

// ============================================================================
// Cascade behavior: primary fails, fallback succeeds
// ============================================================================

// Create a composite with a broken primary and working local fallback
const cascadeConfig = {
  transport: 'composite',
  gateway: { graphqlUrl: 'https://unreachable.invalid/graphql', dataUrl: 'https://unreachable.invalid' },
  bundler: { uploadUrl: 'https://unreachable.invalid/upload' }
};
const cascade = new CompositeTransport(cascadeConfig, tempHome);
// fetchDataItem should skip the failing Arweave and fall through to local
const cascadeFetch = await cascade.fetchDataItem(item.id);
assert.equal(cascadeFetch.id, item.id, 'Cascade fetch falls through to local');

console.log('✓ Cascade fallback to local transport on Arweave failure');

// fetchData should also cascade
const cascadeData = await cascade.fetchData(item.id);
assert.ok(cascadeData.toString().includes('Alan Turing'), 'Cascade fetchData falls through to local');

console.log('✓ Cascade fetchData fallback works');

// ============================================================================
// Cleanup
// ============================================================================

try { fs.rmSync(tempHome, { recursive: true }); } catch {}

console.log('\nComposite transport unit tests passed');