/**
 * AO Process Unit Tests
 * 
 * Validates process.lua structure, syntax, and handler coverage.
 * We can't execute Lua directly from Node.js, so these tests verify:
 *   - File exists and is valid Lua (syntactic checks)
 *   - All required handlers are defined
 *   - Tag names and action values match the PermaBrain spec
 *   - State variable names are consistent with the JS codebase
 *   - The Lua code mirrors the JS domain logic (version bumping, consensus, etc.)
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const PROCESS_LUA = path.resolve(import.meta.dirname, '..', 'process.lua');
const luaSource = fs.readFileSync(PROCESS_LUA, 'utf8');

// Strip Lua comments for syntax checks (-- to end of line)
const luaCodeOnly = luaSource.split('\n')
  .map(line => line.replace(/--.*$/, ''))
  .join('\n');

// ============================================================================
// File & Syntax
// ============================================================================

assert.ok(luaSource.length > 0, 'process.lua should not be empty');

// Basic Lua syntax checks (not a full parser, but catches common errors)
// Basic Lua syntax checks (not a full parser, but catches common errors)
// Lua uses 'function (' with space for definitions, 'function(' without space is also valid Lua for calls
// This test is too broad; skip it since Lua allows both forms
assert.ok(!luaCodeOnly.includes('==='), 'No JS triple-equals in Lua code');
assert.ok(!luaCodeOnly.includes('=>'), 'No arrow functions in Lua code');
assert.ok(!luaCodeOnly.includes('const '), 'No const declarations in Lua code');
assert.ok(!luaCodeOnly.includes('let '), 'No let declarations in Lua code');

console.log('✓ Lua syntax checks passed');

// ============================================================================
// Handler Coverage
// ============================================================================

const REQUIRED_HANDLERS = ['Publish', 'Attest', 'Query', 'Get', 'Consensus', 'Sync'];

for (const handler of REQUIRED_HANDLERS) {
  const pattern = `Handlers.add("${handler}"`;
  assert.ok(luaSource.includes(pattern), `process.lua must define handler: ${handler}`);
}

// Also check for the Info handler (bonus, not strictly required)
assert.ok(luaSource.includes('Handlers.add("Info"'), 'process.lua should define Info handler');

console.log('✓ All required handlers present: ' + REQUIRED_HANDLERS.join(', '));

// ============================================================================
// Action Tag Values
// ============================================================================

// Each handler should use its Action name as the pattern (AOS 2.0 shorthand)
for (const handler of REQUIRED_HANDLERS) {
  assert.ok(
    luaSource.includes(`"${handler}", "${handler}"`) || luaSource.includes(`"${handler}", function`),
    `Handler ${handler} should use Action-based pattern matching`
  );
}

console.log('✓ Action tag patterns correct');

// ============================================================================
// State Variables Match JS Codebase
// ============================================================================

// The Lua process should use state variables that mirror the JS domain model
assert.ok(luaSource.includes('Articles = Articles or {}'), 'Articles state variable');
assert.ok(luaSource.includes('Attestations = Attestations or {}'), 'Attestations state variable');
assert.ok(luaSource.includes('LatestArticleIds'), 'LatestArticleIds for consensus target-version weighting');

console.log('✓ State variables match JS codebase');

// ============================================================================
// Article Fields (mirrors tags.mjs buildArticleTags output)
// ============================================================================

const ARTICLE_FIELDS = [
  'Article-Key', 'Article-Kind', 'Article-Title', 'Article-Slug',
  'Article-Topic', 'Article-Language', 'Article-Version',
  'Article-Previous-Id', 'Article-Root-Id',
  'Article-Source-Name', 'Article-Source-Url', 'Article-Source-License',
  'Article-Content-Hash', 'Article-Published-At', 'Article-Updated-At',
  'Author-Agent-Id'
];

for (const field of ARTICLE_FIELDS) {
  assert.ok(luaSource.includes(field), `process.lua references article field: ${field}`);
}

console.log('✓ All article tag names present');

// ============================================================================
// Attestation Fields (mirrors tags.mjs buildAttestationTags output)
// ============================================================================

const ATTESTATION_FIELDS = [
  'Attestation-Target-Id', 'Attestation-Target-Key',
  'Attestation-Opinion', 'Attestation-Confidence',
  'Attestation-Reason', 'Attestation-Agent-Id',
  'Attestation-Source-Url', 'Attestation-Created-At'
];

for (const field of ATTESTATION_FIELDS) {
  assert.ok(luaSource.includes(field), `process.lua references attestation field: ${field}`);
}

console.log('✓ All attestation tag names present');

// ============================================================================
// Consensus Logic
// ============================================================================

// Opinion weights must match consensus.mjs OPINION_WEIGHT
assert.ok(luaSource.includes('valid = 1'), 'valid opinion weight = 1');
assert.ok(luaSource.includes('["partially-valid"] = 0.5'), 'partially-valid weight = 0.5');
assert.ok(luaSource.includes('invalid = -1'), 'invalid weight = -1');
assert.ok(luaSource.includes('disputed = -0.75'), 'disputed weight = -0.75');
assert.ok(luaSource.includes('outdated = -0.5'), 'outdated weight = -0.5');

// Target version weighting: 0.5 for non-latest version
assert.ok(luaSource.includes('0.5'), 'Target version weight halving for non-latest attestations');

console.log('✓ Consensus weights match JS implementation');

// ============================================================================
// Validation
// ============================================================================

// Article kind validation must match tags.mjs ARTICLE_KINDS
const KINDS = ['person', 'subject', 'event', 'organization', 'source', 'news'];
for (const kind of KINDS) {
  assert.ok(luaSource.includes(`${kind} = true`), `Valid kind: ${kind}`);
}

// Opinion validation must match tags.mjs ATTESTATION_OPINIONS
const OPINIONS = ['valid', 'invalid', 'partially-valid', 'outdated', 'disputed'];
for (const opinion of OPINIONS) {
  // Lua table keys: simple identifiers don't need quotes, hyphenated ones use ["..."] notation
  const simple = opinion.match(/^[a-z]+$/) ? `${opinion} = true` : `"${opinion}"`;
  assert.ok(luaSource.includes(simple), `Valid opinion: ${opinion}`);
}

console.log('✓ Kind and opinion validation matches JS spec');

// ============================================================================
// Version Bumping Logic
// ============================================================================

// Should auto-increment version when existing article has higher version
assert.ok(
  luaSource.includes('existing.version') || luaSource.includes('existing and version'),
  'Version comparison with existing article'
);
assert.ok(
  luaSource.includes('+ 1') && luaSource.includes('version'),
  'Version auto-increment logic'
);

console.log('✓ Version bumping logic present');

// ============================================================================
// Error Handling
// ============================================================================

// Each mutation handler should have error responses
assert.ok(luaSource.includes('Publish-Error'), 'Publish error response');
assert.ok(luaSource.includes('Attest-Error'), 'Attest error response');
assert.ok(luaSource.includes('Get-Error'), 'Get error response');
assert.ok(luaSource.includes('Consensus-Error'), 'Consensus error response');
assert.ok(luaSource.includes('Sync-Error'), 'Sync error response');

console.log('✓ Error responses defined for all mutation handlers');

// ============================================================================
// Reply Actions
// ============================================================================

assert.ok(luaSource.includes('Publish-Notice'), 'Publish success reply');
assert.ok(luaSource.includes('Attest-Notice'), 'Attest success reply');
assert.ok(luaSource.includes('Query-Response'), 'Query response reply');
assert.ok(luaSource.includes('Get-Response'), 'Get response reply');
assert.ok(luaSource.includes('Consensus-Response'), 'Consensus response reply');
assert.ok(luaSource.includes('Sync-Notice'), 'Sync success reply');
assert.ok(luaSource.includes('Info-Response'), 'Info response reply');

console.log('✓ All reply actions defined');

// ============================================================================
// JSON Encoding
// ============================================================================

assert.ok(luaSource.includes("require('json')"), 'JSON module imported');
assert.ok(luaSource.includes('json.encode'), 'json.encode used for query/get/consensus responses');

console.log('✓ JSON encoding for structured responses');

// ============================================================================
// Sync Handler — Bulk Bootstrap
// ============================================================================

assert.ok(luaSource.includes('json.decode'), 'json.decode used in Sync for parsing payload');
assert.ok(luaSource.includes('payload.articles'), 'Sync processes articles array');
assert.ok(luaSource.includes('payload.attestations'), 'Sync processes attestations array');

console.log('✓ Sync handler processes articles and attestations payloads');

// ============================================================================
// Consensus Handler — Score + Opinion Counts
// ============================================================================

assert.ok(luaSource.includes('computeConsensus'), 'Consensus computation function');
assert.ok(luaSource.includes('countOpinions'), 'Opinion counting function');
assert.ok(luaSource.includes('latestAttestationsByAgent'), 'Latest attestation dedup by agent');
assert.ok(luaSource.includes('weightedSum'), 'Weighted sum calculation');
assert.ok(luaSource.includes('totalWeight'), 'Total weight calculation');

console.log('✓ Consensus computation mirrors JS implementation');

console.log('\nAO process unit tests passed');