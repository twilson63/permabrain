/**
 * Test: HTTP API route discovery and OpenAPI JSON endpoint.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import { createServer, startServer, stopServer } from '../src/serve.mjs';
import { createClient } from '../src/client.mjs';
import { api } from '../src/agent-api.mjs';
import { generateApiKey } from '../src/auth.mjs';
import { buildOpenApiDocument, listRoutes } from '../src/route-registry.mjs';

const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'permabrain-serve-openapi-'));
process.env.PERMABRAIN_HOME = tmpHome;
process.env.PERMABRAIN_TRANSPORT = 'local';

function request(method, path, body, extraHeaders = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({
      hostname: 'localhost',
      port,
      method,
      path,
      headers: body ? { 'content-type': 'application/json', ...extraHeaders } : extraHeaders
    }, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          const json = data ? JSON.parse(data) : {};
          resolve({ status: res.statusCode, body: json, raw: data });
        } catch {
          resolve({ status: res.statusCode, body: data, raw: data });
        }
      });
    });
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

let server;
let port;

console.log('1. startServer without API key exposes discovery endpoints');
const started = await startServer({ home: tmpHome, port: 0 });
server = started.server;
port = started.port;
assert.ok(port > 0, 'port assigned');

console.log('2. GET /api/v1/routes returns route catalog');
const routesResp = await request('GET', '/api/v1/routes');
assert.equal(routesResp.status, 200, 'routes status 200');
assert.ok(Array.isArray(routesResp.body.routes), 'routes array present');
assert.ok(routesResp.body.routes.length > 20, 'routes catalog has many entries');
const articlesRoute = routesResp.body.routes.find(r => r.route === '/api/v1/articles' && r.method === 'GET');
assert.ok(articlesRoute, 'GET /api/v1/articles listed');
assert.equal(articlesRoute.public, false, 'article route not public');
assert.ok(Array.isArray(articlesRoute.params), 'article route has params');
const healthRoute = routesResp.body.routes.find(r => r.route === '/health' && r.method === 'GET');
assert.ok(healthRoute, '/health listed');
assert.equal(healthRoute.public, true, '/health public');
console.log('   ✓ /api/v1/routes returns catalog');

console.log('3. GET /api/v1/openapi.json returns OpenAPI 3 document');
const openApiResp = await request('GET', '/api/v1/openapi.json');
assert.equal(openApiResp.status, 200, 'openapi status 200');
assert.equal(openApiResp.body.openapi, '3.0.3', 'openapi version 3.0.3');
assert.ok(openApiResp.body.info, 'openapi info present');
assert.ok(openApiResp.body.paths, 'openapi paths present');
assert.ok(openApiResp.body.components?.securitySchemes?.bearerAuth, 'bearerAuth security scheme present');
assert.ok(openApiResp.body.paths['/api/v1/articles']?.get, 'articles GET in openapi');
assert.ok(openApiResp.body.paths['/api/v1/articles']?.post, 'articles POST in openapi');
console.log('   ✓ /api/v1/openapi.json valid');

console.log('4. SDK client.routes() works');
const client = createClient({ baseUrl: `http://localhost:${port}` });
const clientRoutes = await client.routes();
assert.ok(Array.isArray(clientRoutes.routes), 'client routes returns routes');
assert.ok(clientRoutes.routes.some(r => r.route === '/api/v1/openapi.json'), 'openapi route in client list');
console.log('   ✓ client.routes() works');

console.log('5. SDK client.openapi() works');
const clientOpenApi = await client.openapi();
assert.equal(clientOpenApi.openapi, '3.0.3', 'client openapi version');
assert.ok(clientOpenApi.paths['/api/v1/routes'], 'routes endpoint in openapi');
console.log('   ✓ client.openapi() works');

await stopServer(server);
api._home = undefined;
api._identity = undefined;
api._config = undefined;
fs.rmSync(tmpHome, { recursive: true, force: true });

console.log('6. With API key, discovery endpoints require auth');
const tmpHome2 = fs.mkdtempSync(path.join(os.tmpdir(), 'permabrain-serve-openapi-auth-'));
process.env.PERMABRAIN_HOME = tmpHome2;
const apiKey = generateApiKey();
const started2 = await startServer({ home: tmpHome2, port: 0, apiKey });
const server2 = started2.server;
const port2 = started2.port;

function request2(method, path, body, extraHeaders = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({
      hostname: 'localhost',
      port: port2,
      method,
      path,
      headers: body ? { 'content-type': 'application/json', ...extraHeaders } : extraHeaders
    }, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, body: data ? JSON.parse(data) : {}, raw: data });
        } catch {
          resolve({ status: res.statusCode, body: data, raw: data });
        }
      });
    });
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

const noAuthRoutes = await request2('GET', '/api/v1/routes');
assert.equal(noAuthRoutes.status, 401, 'routes requires auth when api key configured');
const noAuthOpenApi = await request2('GET', '/api/v1/openapi.json');
assert.equal(noAuthOpenApi.status, 401, 'openapi requires auth when api key configured');
const withAuth = await request2('GET', '/api/v1/routes', undefined, { authorization: `Bearer ${apiKey}` });
assert.equal(withAuth.status, 200, 'routes with auth succeeds');
console.log('   ✓ discovery endpoints respect API key auth');

await stopServer(server2);
api._home = undefined;
api._identity = undefined;
api._config = undefined;
fs.rmSync(tmpHome2, { recursive: true, force: true });

console.log('7. buildOpenApiDocument and listRoutes exported from route-registry.mjs');
const doc = buildOpenApiDocument({ requireAuth: true });
assert.equal(doc.openapi, '3.0.3', 'buildOpenApiDocument returns 3.0.3');
assert.ok(doc.paths['/health']?.get, '/health in generated openapi');
const routeList = listRoutes({ authRequired: true });
assert.ok(routeList.some(r => r.route === '/api/v1/openapi.json' && r.method === 'GET'), 'openapi route in listRoutes');
console.log('   ✓ registry helpers exported and functional');

console.log('\n✅ All serve OpenAPI/route discovery tests passed');
