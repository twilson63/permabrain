/**
 * Test: permabrain validate CLI + api.validateMetadata + api.validateDataItem
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { api } from '../src/agent-api.mjs';
import { runCommand } from '../src/commands.mjs';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pb-validate-'));

const validArticle = {
  'App-Name': 'PermaBrain',
  'App-Version': '0.2.0',
  'PermaBrain-Type': 'article',
  'Article-Key': 'subject/demo',
  'Article-Kind': 'subject',
  'Article-Title': 'Demo Article',
  'Article-Slug': 'demo',
  'Article-Topic': 'ai',
  'Article-Language': 'en',
  'Article-Version': 1,
  'Article-Source-Name': 'Example Source',
  'Article-Source-Url': 'https://example.com/demo',
  'Article-Content-Hash': 'sha256:' + 'a'.repeat(64),
  'Article-Published-At': '2024-01-01T00:00:00Z',
  'Article-Updated-At': '2024-01-01T00:00:00Z',
  'Author-Agent-Id': 'ed25519:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
  'Visibility': 'public'
};

const validAttestation = {
  'App-Name': 'PermaBrain',
  'App-Version': '0.2.0',
  'PermaBrain-Type': 'attestation',
  'Attestation-Target-Id': 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  'Attestation-Target-Key': 'subject/demo',
  'Attestation-Opinion': 'valid',
  'Attestation-Confidence': 0.95,
  'Attestation-Reason': 'Looks good',
  'Attestation-Agent-Id': 'ed25519:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
  'Attestation-Created-At': '2024-01-01T00:00:00Z'
};

function tagsToDataItem(tags) {
  return { tags: Object.entries(tags).map(([name, value]) => ({ name, value })) };
}

console.log('1. api.validateMetadata accepts valid article tags');
{
  const result = api.validateMetadata(validArticle, { type: 'article' });
  assert.equal(result.valid, true);
  assert.equal(result.errors.length, 0);
}
console.log('   ✓ api.validateMetadata article OK');

console.log('2. api.validateMetadata rejects invalid article tags');
{
  const tags = { ...validArticle };
  delete tags['Article-Title'];
  const result = api.validateMetadata(tags, { type: 'article' });
  assert.equal(result.valid, false);
}
console.log('   ✓ api.validateMetadata article detects missing field');

console.log('3. api.validateMetadata accepts valid attestation tags');
{
  const result = api.validateMetadata(validAttestation, { type: 'attestation' });
  assert.equal(result.valid, true);
}
console.log('   ✓ api.validateMetadata attestation OK');

console.log('4. api.validateDataItem validates article DataItem');
{
  const result = api.validateDataItem(tagsToDataItem(validArticle), { type: 'article' });
  assert.equal(result.valid, true);
}
console.log('   ✓ api.validateDataItem article OK');

console.log('5. api.validateDataItem validates attestation DataItem');
{
  const result = api.validateDataItem(tagsToDataItem(validAttestation), { type: 'attestation' });
  assert.equal(result.valid, true);
}
console.log('   ✓ api.validateDataItem attestation OK');

console.log('6. CLI validate article with valid flat JSON file');
{
  const file = path.join(tmpDir, 'article.json');
  fs.writeFileSync(file, JSON.stringify(validArticle, null, 2));
  const result = await runCommand('validate', { _: ['article', file], json: true });
  assert.equal(result.valid, true);
}
console.log('   ✓ CLI validate article file OK');

console.log('7. CLI validate article detects invalid DataItem-style file');
{
  const file = path.join(tmpDir, 'article-bad.json');
  const bad = { ...validArticle };
  delete bad['Article-Title'];
  fs.writeFileSync(file, JSON.stringify(tagsToDataItem(bad), null, 2));
  const result = await runCommand('validate', { _: ['article', file], json: true });
  assert.equal(result.valid, false);
}
console.log('   ✓ CLI validate article detects bad DataItem');

console.log('8. CLI validate attestation with tag-array JSON');
{
  const file = path.join(tmpDir, 'attestation.json');
  fs.writeFileSync(file, JSON.stringify(tagsToDataItem(validAttestation), null, 2));
  const result = await runCommand('validate', { _: ['attestation', file], json: true });
  assert.equal(result.valid, true);
}
console.log('   ✓ CLI validate attestation tag-array OK');

console.log('9. CLI validate built-in example when no path given');
{
  const result = await runCommand('validate', { _: ['article'], json: true });
  assert.equal(result.valid, true);
}
console.log('   ✓ CLI validate built-in example OK');

console.log('10. CLI validate default type is article');
{
  const result = await runCommand('validate', { _: [], json: true });
  assert.equal(result.valid, true);
}
console.log('   ✓ CLI validate default type OK');

console.log('\nOK All validate tests passed');
