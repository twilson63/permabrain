/**
 * Test: Webhook registry and HTTP API
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  registerWebhook,
  listWebhooks,
  getWebhook,
  deleteWebhook,
  toggleWebhook,
  webhookHistory,
  testWebhook,
  dispatchWebhookEvent,
  webhooksToMarkdown,
  signWebhookPayload,
  verifyWebhookSignature,
  generateWebhookSecret
} from '../src/webhooks.mjs';
import { api } from '../src/agent-api.mjs';
import { createServer } from '../src/serve.mjs';
import { createClient } from '../src/client.mjs';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pb-webhooks-'));
const deliveryLog = [];
async function mockFetch(url, init) {
  const bodyText = init.body || '';
  const id = init.headers['x-permabrain-delivery'] || 'mock';
  deliveryLog.push({ url, event: init.headers['x-permabrain-event'], signature: init.headers['x-permabrain-signature'], body: bodyText });
  return { status: 200, text: async () => 'ok' };
}
async function failFetch(url, init) {
  deliveryLog.push({ url, event: init.headers['x-permabrain-event'], body: init.body });
  throw new Error('connect failed');
}

console.log('1. Register/list/get/delete/toggle webhooks');
const reg1 = registerWebhook({ home: tmp, url: 'https://example.com/hook', events: ['article.publish'] });
assert.equal(reg1.created, true);
assert.ok(reg1.subscription.id);
assert.equal(reg1.subscription.active, true);
assert.ok(reg1.subscription.secret);
const reg2 = registerWebhook({ home: tmp, url: 'https://example.com/hook', events: ['article.attest'] });
assert.equal(reg2.updated, true);
assert.equal(reg2.subscription.events.includes('article.attest'), true);
const all = listWebhooks({ home: tmp });
assert.equal(all.length, 1);
assert.equal(all[0].secret, undefined);
const allSecrets = listWebhooks({ home: tmp, includeSecrets: true });
assert.ok(allSecrets[0].secret);
const byId = getWebhook({ home: tmp, id: reg1.subscription.id });
assert.equal(byId.url, 'https://example.com/hook');
assert.equal(byId.secret, undefined);
const toggled = toggleWebhook({ home: tmp, id: reg1.subscription.id });
assert.equal(toggled.active, false);
const toggledBack = toggleWebhook({ home: tmp, id: reg1.subscription.id, active: true });
assert.equal(toggledBack.active, true);
console.log('   ✓ registry operations work');

console.log('2. HMAC sign/verify');
const secret = generateWebhookSecret();
const body = JSON.stringify({ a: 1 });
const sig = signWebhookPayload(secret, body);
assert.equal(verifyWebhookSignature(secret, body, sig), true);
assert.equal(verifyWebhookSignature(secret, body, sig + 'x'), false);
console.log('   ✓ sign/verify works');

console.log('3. Dispatch to matching active subscriptions');
deliveryLog.length = 0;
registerWebhook({ home: tmp, url: 'https://dispatch.example.com/hook', events: ['article.publish', 'article.attest', 'article.delete'] });
const dispatchResults = await dispatchWebhookEvent({ home: tmp, event: 'article.publish', payload: { key: 'k' }, fetch: mockFetch });
assert.equal(dispatchResults.length, 1);
assert.equal(dispatchResults[0].status, 'ok');
assert.equal(deliveryLog.length, 1);
assert.equal(deliveryLog[0].event, 'article.publish');
assert.ok(deliveryLog[0].signature.startsWith('sha256='));
await dispatchWebhookEvent({ home: tmp, event: 'article.delete', payload: { key: 'k2' }, fetch: mockFetch });
assert.equal(deliveryLog.length, 2);
const history = webhookHistory({ home: tmp });
assert.equal(history.length, 2);
console.log('   ✓ dispatch and history work');

console.log('4. Test webhook to a URL');
const testRes = await testWebhook({ home: tmp, url: 'https://example.com/hook', payload: { type: 'ping' }, fetch: mockFetch });
assert.equal(testRes.ok, true);
assert.equal(testRes.status, 200);
const testFail = await testWebhook({ home: tmp, url: 'https://example.com/hook', payload: { type: 'ping' }, fetch: failFetch });
assert.equal(testFail.ok, false);
assert.equal(testFail.error, 'connect failed');
console.log('   ✓ test webhook records success and failure');

console.log('5. Markdown report');
const md = webhooksToMarkdown({ home: tmp, limit: 10 });
assert.ok(md.includes('# Webhooks'));
assert.ok(md.includes('https://example.com/hook'));
console.log('   ✓ markdown report renders');

console.log('6. Delete subscription');
const deleted = deleteWebhook({ home: tmp, id: reg1.subscription.id });
assert.equal(deleted.deleted, true);
// Step 3 also registered a dispatch subscription; remove all to clean up.
const remaining = listWebhooks({ home: tmp, includeSecrets: true });
for (const s of remaining) deleteWebhook({ home: tmp, id: s.id });
assert.equal(listWebhooks({ home: tmp }).length, 0);
fs.rmSync(tmp, { recursive: true, force: true });
const tmp2 = fs.mkdtempSync(path.join(os.tmpdir(), 'pb-webhooks-'));
console.log('   ✓ delete works');

console.log('7. Agent API integration');
await api.init({ home: tmp2, keyType: 'ed25519', transport: 'local' });
const agentReg = await api.webhooksRegister({ url: 'https://agent.example.com/webhook', events: ['article.publish'] });
assert.equal(agentReg.created, true);
const agentList = await api.webhooks();
assert.equal(agentList.count, 1);
const agentHistory = await api.webhookHistory();
assert.ok(Array.isArray(agentHistory.deliveries));
console.log('   ✓ agent API methods work');

console.log('8. HTTP server routes via client SDK');
const { server, port } = await (async () => {
  const srv = createServer({ home: tmp2 });
  await new Promise((res) => srv.server.listen(0, res));
  const p = srv.server.address().port;
  return { server: srv.server, port: p };
})();
const client = createClient({ baseUrl: `http://localhost:${port}` });
const regHttp = await client.webhooksRegister({ url: 'https://http.example.com/hook', events: ['*'] });
assert.equal(regHttp.created, true);
const listHttp = await client.webhooks();
assert.equal(listHttp.count >= 1, true);
const testHttp = await client.testWebhook({ url: 'https://http.example.com/hook', payload: { type: 'ping' } });
assert.equal(typeof testHttp.ok, 'boolean');
const historyHttp = await client.webhookHistory();
assert.ok(Array.isArray(historyHttp.deliveries));
const toggleHttp = await client.toggleWebhook({ id: regHttp.subscription.id, active: false });
assert.equal(toggleHttp.active, false);
await new Promise((res) => server.close(res));
fs.rmSync(tmp2, { recursive: true, force: true });
console.log('   ✓ HTTP routes and client SDK work');
console.log('\n✓ Webhook tests passed');
