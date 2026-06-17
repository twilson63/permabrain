/**
 * Test: JSON Schema metadata validation (src/schema.mjs)
 */

import assert from 'node:assert/strict';
import {
  ARTICLE_METADATA_SCHEMA,
  ATTESTATION_METADATA_SCHEMA,
  validateMetadata,
  validateArticleMetadata,
  validateAttestationMetadata,
  validateDataItemTags,
  formatValidationErrors
} from '../src/schema.mjs';

function articleTags(overrides = {}) {
  return {
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
    'Visibility': 'public',
    ...overrides
  };
}

function attestationTags(overrides = {}) {
  return {
    'App-Name': 'PermaBrain',
    'App-Version': '0.2.0',
    'PermaBrain-Type': 'attestation',
    'Attestation-Target-Id': 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    'Attestation-Target-Key': 'subject/demo',
    'Attestation-Opinion': 'valid',
    'Attestation-Confidence': 0.95,
    'Attestation-Reason': 'Looks good',
    'Attestation-Agent-Id': 'ed25519:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
    'Attestation-Created-At': '2024-01-01T00:00:00Z',
    ...overrides
  };
}

console.log('1. Article metadata validation passes for valid tags');
{
  const result = validateArticleMetadata(articleTags());
  assert.equal(result.valid, true);
  assert.equal(result.errors.length, 0);
}
console.log('   ✓ Valid article tags accepted');

console.log('2. Article metadata validation fails on missing required fields');
{
  const tags = articleTags();
  delete tags['Article-Title'];
  const result = validateArticleMetadata(tags);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some(e => e.path === 'Article-Title' && e.message.includes('required')));
}
console.log('   ✓ Missing required field detected');

console.log('3. Article metadata validation checks key pattern');
{
  const result = validateArticleMetadata(articleTags({ 'Article-Key': 'bad key' }));
  assert.equal(result.valid, false);
  assert.ok(result.errors.some(e => e.path === 'Article-Key'));
}
console.log('   ✓ Invalid key pattern rejected');

console.log('4. Article metadata validation checks kind enum');
{
  const result = validateArticleMetadata(articleTags({ 'Article-Kind': 'opinion' }));
  assert.equal(result.valid, false);
  assert.ok(result.errors.some(e => e.path === 'Article-Kind' && e.message.includes('one of')));
}
console.log('   ✓ Invalid kind rejected');

console.log('5. Article metadata validation checks content hash pattern');
{
  const result = validateArticleMetadata(articleTags({ 'Article-Content-Hash': 'sha256:bad' }));
  assert.equal(result.valid, false);
  assert.ok(result.errors.some(e => e.path === 'Article-Content-Hash'));
}
console.log('   ✓ Invalid content hash rejected');

console.log('6. Article metadata validation checks date-time format');
{
  const result = validateArticleMetadata(articleTags({ 'Article-Published-At': 'not-a-date' }));
  assert.equal(result.valid, false);
  assert.ok(result.errors.some(e => e.path === 'Article-Published-At' && e.message.includes('format')));
}
console.log('   ✓ Invalid date-time rejected');

console.log('7. Article metadata validation rejects additional non-string properties');
{
  const result = validateArticleMetadata(articleTags({ 'Custom-Flag': true }));
  assert.equal(result.valid, false);
  assert.ok(result.errors.some(e => e.path === 'Custom-Flag'));
}
console.log('   ✓ Non-string additional property rejected');

console.log('8. Attestation metadata validation passes for valid tags');
{
  const result = validateAttestationMetadata(attestationTags());
  assert.equal(result.valid, true);
  assert.equal(result.errors.length, 0);
}
console.log('   ✓ Valid attestation tags accepted');

console.log('9. Attestation metadata validation fails on missing target key');
{
  const tags = attestationTags();
  delete tags['Attestation-Target-Key'];
  const result = validateAttestationMetadata(tags);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some(e => e.path === 'Attestation-Target-Key'));
}
console.log('   ✓ Missing attestation target key detected');

console.log('10. Attestation metadata validation checks confidence range');
{
  const result = validateAttestationMetadata(attestationTags({ 'Attestation-Confidence': 1.5 }));
  assert.equal(result.valid, false);
  assert.ok(result.errors.some(e => e.path === 'Attestation-Confidence' && e.message.includes('maximum')));
}
console.log('   ✓ Confidence out of range rejected');

console.log('11. Attestation metadata validation checks opinion enum');
{
  const result = validateAttestationMetadata(attestationTags({ 'Attestation-Opinion': 'maybe' }));
  assert.equal(result.valid, false);
  assert.ok(result.errors.some(e => e.path === 'Attestation-Opinion' && e.message.includes('one of')));
}
console.log('   ✓ Invalid opinion rejected');

console.log('12. validateDataItemTags converts tags array to object and validates article');
{
  const dataItem = {
    tags: Object.entries(articleTags()).map(([name, value]) => ({ name, value }))
  };
  const result = validateDataItemTags(dataItem, 'article');
  assert.equal(result.valid, true);
}
console.log('   ✓ DataItem article tags validated');

console.log('12b. validateDataItemTags coerces numeric string tags');
{
  const tags = articleTags();
  tags['Article-Version'] = '2';
  const dataItem = {
    tags: Object.entries(tags).map(([name, value]) => ({ name, value }))
  };
  const result = validateDataItemTags(dataItem, 'article');
  assert.equal(result.valid, true);
}
console.log('   ✓ Numeric string tags coerced and validated');

console.log('13. validateDataItemTags validates attestation DataItem');
{
  const dataItem = {
    tags: Object.entries(attestationTags()).map(([name, value]) => ({ name, value }))
  };
  const result = validateDataItemTags(dataItem, 'attestation');
  assert.equal(result.valid, true);
}
console.log('   ✓ DataItem attestation tags validated');

console.log('14. validateDataItemTags returns error for unknown type');
{
  const result = validateDataItemTags({ tags: [] }, 'unknown');
  assert.equal(result.valid, false);
  assert.ok(result.errors[0].message.includes('unknown type'));
}
console.log('   ✓ Unknown type rejected');

console.log('15. formatValidationErrors renders OK and errors');
{
  assert.equal(formatValidationErrors({ valid: true, errors: [] }), 'OK');
  const text = formatValidationErrors({ valid: false, errors: [{ path: 'x', message: 'bad' }] });
  assert.equal(text, 'x: bad');
}
console.log('   ✓ Error formatting works');

console.log('16. Schema constants are exported objects');
{
  assert.equal(typeof ARTICLE_METADATA_SCHEMA, 'object');
  assert.equal(typeof ATTESTATION_METADATA_SCHEMA, 'object');
  assert.ok(ARTICLE_METADATA_SCHEMA.required.includes('Article-Key'));
  assert.ok(ATTESTATION_METADATA_SCHEMA.required.includes('Attestation-Target-Id'));
}
console.log('   ✓ Schema constants exported');

console.log('\nOK All schema tests passed');
