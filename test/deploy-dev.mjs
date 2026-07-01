/**
 * Tests for the deploy-dev HyperBEAM Forge dev-container helper.
 *
 * These tests mock Docker and the HyperBEAM /~meta@1.0/info endpoint so the
 * suite can run in sandboxes that do not have docker or Erlang installed.
 */

import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { execSync } from 'node:child_process';
import { join } from 'node:path';
import {
  deployDev,
  imageExists,
  runContainer,
  waitForDevices,
  containerLogs,
  stopDev,
  listPermabrainDevContainers,
} from '../src/deploy-dev.mjs';

function fakeSpawn(logs, outputs) {
  return (cmd, args) => {
    const key = [cmd, ...args].join(' ');
    logs.push(key);
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    const out = outputs[key] ?? { code: 0, stdout: '', stderr: '' };
    setImmediate(() => {
      if (out.stderr) child.stderr.emit('data', Buffer.from(out.stderr));
      if (out.stdout) child.stdout.emit('data', Buffer.from(out.stdout));
      child.emit('close', out.code ?? 0);
    });
    return child;
  };
}

function fakeFetch(responses) {
  let i = 0;
  return async () => {
    const r = responses[i++];
    if (r instanceof Error) throw r;
    return {
      ok: r.ok,
      text: async () => r.body,
    };
  };
}

function fakeLog() {
  const out = [];
  return {
    log: (...args) => out.push(args.join(' ')),
    error: (...args) => out.push(args.join(' ')),
    get output() {
      return out;
    },
  };
}

console.log('1. deployDev dry-run returns plan with defaults');
{
  const log = fakeLog();
  const result = await deployDev({ 'dry-run': true }, { log });
  assert.equal(result.image, 'ghcr.io/twilson63/hyperbeam-dev:latest');
  assert.equal(result.port, 8734);
  assert.equal(result.verifyUrl, 'http://localhost:8734/~meta@1.0/info');
  assert.ok(result.projectDir.endsWith('/hb-forge'), 'default project dir ends with /hb-forge');
  assert.deepEqual(result.requiredDevices, ['permabrain-consensus', 'permabrain-query']);
  assert.ok(log.output.some((line) => line.includes('Dry-run plan')));
}
console.log('   ✓ dry-run defaults good');

console.log('2. deployDev honors custom image, port, and project-dir');
{
  const log = fakeLog();
  const result = await deployDev(
    { 'dry-run': true, image: 'my-image:tag', port: '9000', 'project-dir': 'hb-forge' },
    { log }
  );
  assert.equal(result.image, 'my-image:tag');
  assert.equal(result.port, 9000);
  assert.equal(result.verifyUrl, 'http://localhost:9000/~meta@1.0/info');
}
console.log('   ✓ custom options honored');

console.log('3. deployDev skips pull when image exists and deploys successfully');
{
  const logs = [];
  const image = 'ghcr.io/twilson63/hyperbeam-dev:latest';
  const outputs = {
    [`docker images --format {{.Repository}}:{{.Tag}} ${image.split(':')[0]}`]: {
      code: 0,
      stdout: `${image}\n`,
    },
    'docker run -d --rm --name permabrain-dev-8734 -p 8734:8734 -v ': {
      // The exact key depends on the resolved project path; match with a fallback below.
    },
  };
  const spawnFn = (cmd, args) => {
    const key = [cmd, ...args].join(' ');
    logs.push(key);
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    let out;
    if (key.startsWith('docker images')) {
      out = { code: 0, stdout: `${image}\n` };
    } else if (key.startsWith('docker run')) {
      out = { code: 0, stdout: 'abc123def456\n' };
    } else {
      out = { code: 0, stdout: '' };
    }
    setImmediate(() => {
      if (out.stderr) child.stderr.emit('data', Buffer.from(out.stderr));
      if (out.stdout) child.stdout.emit('data', Buffer.from(out.stdout));
      child.emit('close', out.code ?? 0);
    });
    return child;
  };

  const metaInfo = {
    devices: {
      'permabrain-consensus': {},
      'permabrain-query': {},
      other: {},
    },
  };
  const fetchFn = fakeFetch([{ ok: true, body: JSON.stringify(metaInfo) }]);
  const log = fakeLog();
  const result = await deployDev({}, { spawnFn, fetchFn, log });

  assert.equal(result.ok, true);
  assert.equal(result.containerId, 'abc123def456');
  assert.ok(logs.some((k) => k.startsWith('docker images')), 'checked local image');
  assert.ok(logs.some((k) => k.startsWith('docker run')), 'ran container');
  assert.ok(!logs.some((k) => k.startsWith('docker pull')), 'did not pull existing image');
  assert.ok(log.output.some((line) => line.includes('deployed and verified')));
}
console.log('   ✓ existing image deploys and verifies');

console.log('4. deployDev pulls missing image before running container');
{
  const logs = [];
  const image = 'ghcr.io/twilson63/hyperbeam-dev:latest';
  const spawnFn = (cmd, args) => {
    const key = [cmd, ...args].join(' ');
    logs.push(key);
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    let out;
    if (key.startsWith('docker images')) {
      out = { code: 0, stdout: 'other-image:latest\n' };
    } else if (key === `docker pull ${image}`) {
      out = { code: 0, stdout: 'pulled\n' };
    } else if (key.startsWith('docker run')) {
      out = { code: 0, stdout: 'xyz789\n' };
    } else {
      out = { code: 0, stdout: '' };
    }
    setImmediate(() => {
      if (out.stderr) child.stderr.emit('data', Buffer.from(out.stderr));
      if (out.stdout) child.stdout.emit('data', Buffer.from(out.stdout));
      child.emit('close', out.code ?? 0);
    });
    return child;
  };
  const metaInfo = { devices: ['permabrain-consensus', 'permabrain-query'] };
  const fetchFn = fakeFetch([{ ok: true, body: JSON.stringify(metaInfo) }]);
  const result = await deployDev({}, { spawnFn, fetchFn, log: fakeLog() });
  assert.equal(result.ok, true);
  assert.equal(result.containerId, 'xyz789');
  assert.ok(logs.some((k) => k.startsWith('docker pull')), 'pulled missing image');
}
console.log('   ✓ missing image is pulled');

console.log('5. deployDev reports error when required devices are missing');
{
  const image = 'ghcr.io/twilson63/hyperbeam-dev:latest';
  const spawnFn = (cmd, args) => {
    const key = [cmd, ...args].join(' ');
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    let out;
    if (key.startsWith('docker images')) {
      out = { code: 0, stdout: `${image}\n` };
    } else if (key.startsWith('docker run')) {
      out = { code: 0, stdout: 'c1\n' };
    } else {
      out = { code: 0, stdout: '' };
    }
    setImmediate(() => {
      if (out.stdout) child.stdout.emit('data', Buffer.from(out.stdout));
      child.emit('close', out.code ?? 0);
    });
    return child;
  };
  const fetchFn = fakeFetch([
    { ok: true, body: JSON.stringify({ devices: ['other-device'] }) },
  ]);
  await assert.rejects(
    deployDev({ timeout: 50 }, { spawnFn, fetchFn, log: fakeLog() }),
    /Timed out waiting for permabrain-consensus and permabrain-query/
  );
}
console.log('   ✓ missing devices cause timeout error');

console.log('6. deployDev surfaces clear error when docker is missing');
{
  const spawnFn = () => {
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    setImmediate(() => child.emit('error', { code: 'ENOENT' }));
    return child;
  };
  await assert.rejects(
    deployDev({}, { spawnFn, fetchFn: fakeFetch([]), log: fakeLog() }),
    /Docker is not installed/
  );
}
console.log('   ✓ docker missing error is clear');

console.log('7. imageExists returns true when image is listed');
{
  const spawnFn = fakeSpawn([], {
    'docker images --format {{.Repository}}:{{.Tag}} ghcr.io/twilson63/hyperbeam-dev': {
      code: 0,
      stdout: 'ghcr.io/twilson63/hyperbeam-dev:latest\n',
    },
  });
  assert.equal(await imageExists('ghcr.io/twilson63/hyperbeam-dev:latest', { spawnFn }), true);
}
console.log('   ✓ imageExists true');

console.log('8. imageExists returns false when image is not listed');
{
  const spawnFn = fakeSpawn([], {
    'docker images --format {{.Repository}}:{{.Tag}} ghcr.io/twilson63/hyperbeam-dev': {
      code: 0,
      stdout: 'ghcr.io/twilson63/hyperbeam-dev:old\n',
    },
  });
  assert.equal(await imageExists('ghcr.io/twilson63/hyperbeam-dev:latest', { spawnFn }), false);
}
console.log('   ✓ imageExists false');

console.log('9. runContainer returns container id');
{
  const spawnFn = (cmd, args) => {
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    setImmediate(() => {
      child.stdout.emit('data', Buffer.from('container-id-1\n'));
      child.emit('close', 0);
    });
    return child;
  };
  const result = await runContainer(
    { image: 'img', port: 8734, projectDir: '/work' },
    { spawnFn }
  );
  assert.equal(result.containerId, 'container-id-1');
  assert.equal(result.name, 'permabrain-dev-8734');
}
console.log('   ✓ runContainer returns id and name');

console.log('10. waitForDevices retries and succeeds');
{
  const log = fakeLog();
  const metaInfo = {
    devices: { 'permabrain-consensus': {}, 'permabrain-query': {} },
  };
  const fetchFn = fakeFetch([
    { ok: false, body: '' },
    new Error('connect ECONNREFUSED'),
    { ok: true, body: JSON.stringify(metaInfo) },
  ]);
  const result = await waitForDevices(
    'http://localhost:8734/~meta@1.0/info',
    ['permabrain-consensus', 'permabrain-query'],
    { fetchFn, timeoutMs: 5_000, intervalMs: 10, log }
  );
  assert.equal(result.ok, true);
  assert.ok(log.output.length >= 2, 'logged wait messages');
}
console.log('   ✓ waitForDevices retries and succeeds');

console.log('11. CLI deploy-dev --help works');
{
  const help = execSync(`node ${join(process.cwd(), 'scripts/cli.mjs')} deploy-dev --help`, {
    encoding: 'utf8',
  });
  assert.match(help, /deploy-dev/);
  assert.match(help, /--image/);
  assert.match(help, /--port/);
  assert.match(help, /--project-dir/);
  assert.match(help, /--pull/);
}
console.log('   ✓ CLI help works');

console.log('12. deployDev --logs includes log capture plan in dry-run');
{
  const log = fakeLog();
  const result = await deployDev({ 'dry-run': true, logs: true, 'log-lines': '25' }, { log });
  assert.equal(result.logs, true);
  assert.equal(result.logLines, 25);
}
console.log('   ✓ dry-run logs options included');

console.log('13. deployDev --logs captures container logs on timeout');
{
  const image = 'ghcr.io/twilson63/hyperbeam-dev:latest';
  const logs = [];
  const spawnFn = (cmd, args) => {
    const key = [cmd, ...args].join(' ');
    logs.push(key);
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    let out;
    if (key.startsWith('docker images')) {
      out = { code: 0, stdout: `${image}\n` };
    } else if (key.startsWith('docker run')) {
      out = { code: 0, stdout: 'c1\n' };
    } else if (key.startsWith('docker logs')) {
      out = { code: 0, stdout: 'rebar3 crash: no devices loaded\n' };
    } else {
      out = { code: 0, stdout: '' };
    }
    setImmediate(() => {
      if (out.stderr) child.stderr.emit('data', Buffer.from(out.stderr));
      if (out.stdout) child.stdout.emit('data', Buffer.from(out.stdout));
      child.emit('close', out.code ?? 0);
    });
    return child;
  };
  const fetchFn = fakeFetch([
    { ok: true, body: JSON.stringify({ devices: ['other-device'] }) },
  ]);
  const log = fakeLog();
  let err;
  try {
    await deployDev({ timeout: 50, logs: true }, { spawnFn, fetchFn, log });
    assert.fail('expected deployDev to throw');
  } catch (e) {
    err = e;
  }
  assert.match(err.message, /Timed out waiting/);
  assert.equal(err.logs, 'rebar3 crash: no devices loaded');
  assert.ok(logs.some((k) => k.startsWith('docker logs')), 'fetched container logs');
  assert.ok(log.output.some((line) => line.includes('Recent container logs')));
  assert.ok(log.output.some((line) => line.includes('rebar3 crash')));
}
console.log('   ✓ logs captured on timeout');

console.log('14. containerLogs fetches last N lines');
{
  const spawnFn = (cmd, args) => {
    assert.equal(cmd, 'docker');
    assert.deepEqual(args.slice(0, 3), ['logs', '--tail', '10']);
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    setImmediate(() => {
      child.stdout.emit('data', Buffer.from('line1\nline2\n'));
      child.emit('close', 0);
    });
    return child;
  };
  const result = await containerLogs('permabrain-dev-8734', { spawnFn, lines: 10 });
  assert.equal(result.logs, 'line1\nline2');
}
console.log('   ✓ containerLogs works');

console.log('15. stopDev stops and removes default container by port');
{
  const logs = [];
  const spawnFn = (cmd, args) => {
    const key = [cmd, ...args].join(' ');
    logs.push(key);
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    setImmediate(() => child.emit('close', 0));
    return child;
  };
  const log = fakeLog();
  const result = await stopDev({}, { spawnFn, log });
  assert.deepEqual(result.stopped, ['permabrain-dev-8734']);
  assert.ok(logs.includes('docker stop permabrain-dev-8734'));
  assert.ok(logs.includes('docker rm permabrain-dev-8734'));
  assert.ok(log.output.some((line) => line.includes('Stopped and removed permabrain-dev-8734')));
}
console.log('   ✓ stopDev default port');

console.log('16. stopDev --all discovers and stops all dev containers');
{
  const logs = [];
  const spawnFn = (cmd, args) => {
    const key = [cmd, ...args].join(' ');
    logs.push(key);
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    if (key.startsWith('docker ps')) {
      setImmediate(() => child.stdout.emit('data', Buffer.from('permabrain-dev-8734\npermabrain-dev-9000\n')));
    }
    setImmediate(() => child.emit('close', 0));
    return child;
  };
  const result = await stopDev({ all: true }, { spawnFn, log: fakeLog() });
  assert.deepEqual(result.stopped, ['permabrain-dev-8734', 'permabrain-dev-9000']);
  assert.ok(logs.includes('docker stop permabrain-dev-8734'));
  assert.ok(logs.includes('docker stop permabrain-dev-9000'));
}
console.log('   ✓ stopDev --all');

console.log('17. stopDev reports no containers when none exist');
{
  const spawnFn = (cmd, args) => {
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    setImmediate(() => child.emit('close', 0));
    return child;
  };
  const log = fakeLog();
  const result = await stopDev({ all: true }, { spawnFn, log });
  assert.deepEqual(result.stopped, []);
  assert.ok(log.output.some((line) => line.includes('No permabrain-dev-* containers found')));
}
console.log('   ✓ stopDev empty list');

console.log('18. stopDev --json outputs JSON');
{
  const spawnFn = (cmd, args) => {
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    setImmediate(() => child.emit('close', 0));
    return child;
  };
  const log = fakeLog();
  const result = await stopDev({ port: '9000', json: true }, { spawnFn, log });
  assert.equal(result.ok, true);
  assert.deepEqual(result.stopped, ['permabrain-dev-9000']);
  assert.ok(log.output.some((line) => line.includes('"stopped"')));
}
console.log('   ✓ stopDev --json');

console.log('19. stopDev --container-name targets a specific container');
{
  const logs = [];
  const spawnFn = (cmd, args) => {
    logs.push([cmd, ...args].join(' '));
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    setImmediate(() => child.emit('close', 0));
    return child;
  };
  const result = await stopDev({ 'container-name': 'custom-dev' }, { spawnFn, log: fakeLog() });
  assert.deepEqual(result.stopped, ['custom-dev']);
  assert.ok(logs.includes('docker stop custom-dev'));
}
console.log('   ✓ stopDev custom container name');

console.log('20. listPermabrainDevContainers filters dev containers');
{
  const spawnFn = (cmd, args) => {
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    setImmediate(() => {
      child.stdout.emit('data', Buffer.from('permabrain-dev-8734\nother-thing\npermabrain-dev-9000\n'));
      child.emit('close', 0);
    });
    return child;
  };
  const names = await listPermabrainDevContainers(spawnFn);
  assert.deepEqual(names, ['permabrain-dev-8734', 'permabrain-dev-9000']);
}
console.log('   ✓ listPermabrainDevContainers filters');

console.log('21. CLI stop-dev --help works');
{
  const help = execSync(`node ${join(process.cwd(), 'scripts/cli.mjs')} stop-dev --help`, {
    encoding: 'utf8',
  });
  assert.match(help, /stop-dev/);
  assert.match(help, /--port/);
  assert.match(help, /--all/);
  assert.match(help, /--container-name/);
}
console.log('   ✓ stop-dev CLI help works');

console.log('✅ All deploy-dev tests passed');
