/**
 * Test: API key authentication helpers
 */

import assert from 'node:assert/strict';
import { createApiKeyAuth, generateApiKey, hashApiKey } from '../src/auth.mjs';

console.log('1. generateApiKey produces prefixed base64url keys');
const key = generateApiKey();
assert.ok(key.startsWith('pb_'), 'key has pb_ prefix');
assert.ok(key.length > 40, 'key is reasonably long');
console.log('   ✓ generateApiKey');

console.log('2. hashApiKey returns deterministic SHA-256 digest');
const h1 = hashApiKey(key);
const h2 = hashApiKey(key);
assert.equal(h1, h2, 'hash is deterministic');
assert.ok(!h1.includes(key), 'hash does not contain the raw key');
console.log('   ✓ hashApiKey');

console.log('3. createApiKeyAuth with no key allows all requests');
const permissive = createApiKeyAuth({});
assert.equal(permissive.check({ headers: {}, url: '/' }).ok, true, 'no key → allowed');
assert.equal(permissive.apiKeys.length, 0, 'no configured keys');
console.log('   ✓ permissive auth');

console.log('4. extractKey reads Authorization: Bearer header');
const auth = createApiKeyAuth({ apiKey: key });
const bearerResult = auth.check({ headers: { authorization: `Bearer ${key}` }, url: '/' });
assert.equal(bearerResult.ok, true, 'bearer header accepted');
console.log('   ✓ bearer header');

console.log('5. extractKey reads X-Api-Key header (case-insensitive)');
assert.equal(auth.check({ headers: { 'x-api-key': key }, url: '/' }).ok, true, 'x-api-key accepted');
assert.equal(auth.check({ headers: { 'X-Api-Key': key }, url: '/' }).ok, true, 'X-Api-Key accepted');
console.log('   ✓ x-api-key header');

console.log('6. extractKey reads ?api-key query parameter');
assert.equal(auth.check({ headers: {}, url: `/health?api-key=${encodeURIComponent(key)}` }).ok, true, 'query key accepted');
assert.equal(auth.check({ headers: {}, url: `/health?apiKey=${encodeURIComponent(key)}` }).ok, true, 'apiKey query accepted');
console.log('   ✓ query parameter');

console.log('7. extractKey reads body field for POST');
assert.equal(auth.check({ headers: {}, url: '/' }, { apiKey: key }).ok, true, 'body apiKey accepted');
assert.equal(auth.check({ headers: {}, url: '/' }, { 'api-key': key }).ok, true, 'body api-key accepted');
console.log('   ✓ body field');

console.log('8. missing key returns 401');
const missing = auth.check({ headers: {}, url: '/' });
assert.equal(missing.ok, false, 'missing key rejected');
assert.equal(missing.status, 401, 'missing key status 401');
console.log('   ✓ 401 on missing key');

console.log('9. wrong key returns 403');
const wrong = auth.check({ headers: { authorization: 'Bearer not-the-key' }, url: '/' });
assert.equal(wrong.ok, false, 'wrong key rejected');
assert.equal(wrong.status, 403, 'wrong key status 403');
console.log('   ✓ 403 on wrong key');

console.log('10. multiple configured API keys');
const keyB = generateApiKey();
const multi = createApiKeyAuth({ apiKeys: [key, keyB] });
assert.equal(multi.check({ headers: { authorization: `Bearer ${keyB}` }, url: '/' }).ok, true, 'second key accepted');
assert.equal(multi.check({ headers: { authorization: `Bearer ${key}` }, url: '/' }).ok, true, 'first key accepted');
assert.equal(multi.check({ headers: { authorization: 'Bearer pb_forged' }, url: '/' }).ok, false, 'forged key rejected');
console.log('   ✓ multiple keys');

console.log('11. constant-time comparison rejects partial prefix');
const partial = key.slice(0, 6);
const prefixAttack = auth.check({ headers: { authorization: `Bearer ${partial}` }, url: '/' });
assert.equal(prefixAttack.ok, false, 'prefix key rejected');
console.log('   ✓ prefix attack rejected');

console.log('12. custom header name');
const custom = createApiKeyAuth({ apiKey: key, headerName: 'x-permabrain-token' });
assert.equal(custom.check({ headers: { 'x-permabrain-token': key }, url: '/' }).ok, true, 'custom header accepted');
assert.equal(custom.check({ headers: { 'x-api-key': key }, url: '/' }).ok, false, 'default header rejected when custom set');
console.log('   ✓ custom header name');

console.log('\n✅ All auth helper tests passed');
