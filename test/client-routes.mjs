/**
 * Test: permabrain client routes/openapi CLI actions.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { startServer, stopServer } from '../src/serve.mjs';
import { runCommand } from '../src/commands.mjs';
import { api } from '../src/agent-api.mjs';
import { generateApiKey } from '../src/auth.mjs';

const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'permabrain-client-routes-'));
process.env.PERMABRAIN_HOME = tmpHome;
process.env.PERMABRAIN_TRANSPORT = 'local';

let server;
let port;

console.log('1. start server for client routes tests');
const started = await startServer({ home: tmpHome, port: 0 });
server = started.server;
port = started.port;
assert.ok(port > 0, 'server assigned port');

console.log('2. client routes action returns route catalog');
const routesResult = await runCommand('client', {
  _: ['routes'],
  url: `http://localhost:${port}`,
  json: true
});
assert.ok(Array.isArray(routesResult.routes), 'routes array present');
assert.ok(routesResult.routes.length > 20, 'routes catalog has many entries');
assert.ok(routesResult.routes.some((r) => r.route === '/api/v1/routes' && r.method === 'GET'), 'self route listed');
assert.ok(routesResult.routes.some((r) => r.route === '/api/v1/openapi.json' && r.method === 'GET'), 'openapi route listed');
console.log('   ✓ client routes action');

console.log('3. client openapi action returns OpenAPI document');
const openapiResult = await runCommand('client', {
  _: ['openapi'],
  url: `http://localhost:${port}`,
  json: true
});
assert.equal(openapiResult.openapi, '3.0.3', 'openapi version');
assert.ok(openapiResult.info, 'openapi info present');
assert.ok(openapiResult.paths, 'openapi paths present');
assert.ok(openapiResult.paths['/api/v1/routes']?.get, 'routes path in openapi');
console.log('   ✓ client openapi action');

await stopServer(server);
api._home = undefined;
api._identity = undefined;
api._config = undefined;

console.log('4. client routes/openapi respect API-key auth');
const tmpHome2 = fs.mkdtempSync(path.join(os.tmpdir(), 'permabrain-client-routes-auth-'));
process.env.PERMABRAIN_HOME = tmpHome2;
const apiKey = generateApiKey();
const started2 = await startServer({ home: tmpHome2, port: 0, apiKey });
const server2 = started2.server;
const port2 = started2.port;

let threwWithoutKey = false;
try {
  await runCommand('client', { _: ['routes'], url: `http://localhost:${port2}`, json: true });
} catch (err) {
  threwWithoutKey = err.status === 401 || err.message?.includes('401') || err.message?.includes('Unauthorized');
}
assert.ok(threwWithoutKey, 'routes without api key throws 401');

const authRoutes = await runCommand('client', {
  _: ['routes'],
  url: `http://localhost:${port2}`,
  'api-key': apiKey,
  json: true
});
assert.ok(Array.isArray(authRoutes.routes), 'routes with api key succeeds');

const authOpenapi = await runCommand('client', {
  _: ['openapi'],
  url: `http://localhost:${port2}`,
  'api-key': apiKey,
  json: true
});
assert.equal(authOpenapi.openapi, '3.0.3', 'openapi with api key succeeds');
console.log('   ✓ client routes/openapi auth');

await stopServer(server2);
api._home = undefined;
api._identity = undefined;
api._config = undefined;

fs.rmSync(tmpHome, { recursive: true, force: true });
fs.rmSync(tmpHome2, { recursive: true, force: true });

console.log('\n✅ All client routes/openapi CLI tests passed');
