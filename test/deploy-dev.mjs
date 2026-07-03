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
  getDevContainerStatus,
  statusDev,
  buildDevImage,
  restartDev,
  logsDev,
  streamLogs,
  execDev,
  watchDev,
  waitDev,
  checkDev,
  verifyDev,
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
  assert.match(help, /--tail/);
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

console.log('22. getDevContainerStatus reports running and healthy container');
{
  const logs = [];
  const spawnFn = (cmd, args) => {
    logs.push([cmd, ...args].join(' '));
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    setImmediate(() => {
      child.stdout.emit('data', Buffer.from('permabrain-dev-8734\t0.0.0.0:8734->8734/tcp\tUp 2 minutes\tabc123\n'));
      child.emit('close', 0);
    });
    return child;
  };
  const fetchFn = () => Promise.resolve({ ok: true, text: async () => '{"permabrain-consensus": true, "permabrain-query": true}' });
  const result = await getDevContainerStatus({}, { spawnFn, fetchFn });
  assert.equal(result.ok, true);
  assert.equal(result.running, true);
  assert.equal(result.healthy, true);
  assert.equal(result.container.port, 8734);
  assert.equal(result.container.name, 'permabrain-dev-8734');
}
console.log('   ✓ getDevContainerStatus running + healthy');

console.log('23. getDevContainerStatus reports not running');
{
  const spawnFn = (cmd, args) => {
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    setImmediate(() => child.emit('close', 0));
    return child;
  };
  const result = await getDevContainerStatus({}, { spawnFn });
  assert.equal(result.running, false);
  assert.equal(result.container, null);
  assert.equal(result.healthy, null);
}
console.log('   ✓ getDevContainerStatus not running');

console.log('24. getDevContainerStatus marks unhealthy when devices are missing');
{
  const spawnFn = (cmd, args) => {
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    setImmediate(() => {
      child.stdout.emit('data', Buffer.from('permabrain-dev-8734\t0.0.0.0:8734->8734/tcp\tUp 1 minute\tabc123\n'));
      child.emit('close', 0);
    });
    return child;
  };
  const fetchFn = () => Promise.resolve({ ok: true, text: async () => '{"other-device": true}' });
  const result = await getDevContainerStatus({}, { spawnFn, fetchFn });
  assert.equal(result.running, true);
  assert.equal(result.healthy, false);
}
console.log('   ✓ getDevContainerStatus missing devices');

console.log('25. statusDev --all reports multiple containers');
{
  const fetchFn = (() => {
    let i = 0;
    const responses = [
      { ok: true, text: async () => '{"permabrain-consensus": true, "permabrain-query": true}' },
      { ok: true, text: async () => '{"permabrain-consensus": true, "permabrain-query": true}' },
    ];
    return async () => responses[i++];
  })();
  const spawnFn = (cmd, args) => {
    const key = [cmd, ...args].join(' ');
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    if (key.startsWith('docker ps -a')) {
      setImmediate(() => child.stdout.emit('data', Buffer.from('permabrain-dev-8734\npermabrain-dev-9000\n')));
    } else if (key.startsWith('docker ps --format')) {
      const name = args[args.indexOf('--filter') + 1].split('=')[1];
      const port = name.split('-').pop();
      setImmediate(() => child.stdout.emit('data', Buffer.from(`${name}\t0.0.0.0:${port}->8734/tcp\tUp\tid-${port}\n`)));
    }
    setImmediate(() => child.emit('close', 0));
    return child;
  };
  const log = fakeLog();
  const result = await statusDev({ all: true }, { spawnFn, fetchFn, log });
  assert.equal(result.total, 2);
  assert.equal(result.containers[0].healthy, true);
  assert.ok(result.containers[1].container.ports.includes('9000'), 'second container exposes port 9000');
}
console.log('   ✓ statusDev --all');

console.log('26. statusDev prints not-running message');
{
  const spawnFn = (cmd, args) => {
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    setImmediate(() => child.emit('close', 0));
    return child;
  };
  const log = fakeLog();
  const result = await statusDev({}, { spawnFn, log });
  assert.equal(result.running, false);
  assert.ok(log.output.some((line) => line.includes('No permabrain-dev container is running')));
}
console.log('   ✓ statusDev not running message');

console.log('27. statusDev --json outputs structured status');
{
  const spawnFn = (cmd, args) => {
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    setImmediate(() => {
      child.stdout.emit('data', Buffer.from('permabrain-dev-9999\t0.0.0.0:9999->8734/tcp\tUp\tdef789\n'));
      child.emit('close', 0);
    });
    return child;
  };
  const fetchFn = () => Promise.resolve({ ok: true, text: async () => '{"permabrain-consensus": true, "permabrain-query": true}' });
  const log = fakeLog();
  const result = await statusDev({ port: '9999', json: true }, { spawnFn, fetchFn, log });
  assert.equal(result.running, true);
  assert.equal(result.healthy, true);
  assert.ok(log.output.some((line) => line.includes('"running"')));
}
console.log('   ✓ statusDev --json');

console.log('28. CLI status-dev --help works');
{
  const help = execSync(`node ${join(process.cwd(), 'scripts/cli.mjs')} status-dev --help`, {
    encoding: 'utf8',
  });
  assert.match(help, /status-dev/);
  assert.match(help, /--port/);
  assert.match(help, /--all/);
  assert.match(help, /--container-name/);
}
console.log('   ✓ status-dev CLI help works');

console.log('29. buildDevImage dry-run returns plan');
{
  const log = fakeLog();
  const result = await buildDevImage({ 'dry-run': true }, { log });
  assert.equal(result.image, 'ghcr.io/twilson63/hyperbeam-dev:latest');
  assert.ok(result.projectDir.endsWith('/hb-forge'), 'default project dir ends with /hb-forge');
  assert.ok(result.script.endsWith('hb-forge/scripts/build-dev-image.sh'), 'script path correct');
  assert.equal(result.mode, '');
  assert.ok(log.output.some((line) => line.includes('Dry-run plan')));
}
console.log('   ✓ buildDevImage dry-run');

console.log('30. buildDevImage dry-run honors --version, --push, and --multiarch');
{
  const log = fakeLog();
  const result = await buildDevImage(
    { 'dry-run': true, version: '0.2.0', push: true },
    { log }
  );
  assert.equal(result.image, 'ghcr.io/twilson63/hyperbeam-dev:0.2.0');
  assert.equal(result.mode, '--push');
  const multi = await buildDevImage({ 'dry-run': true, multiarch: true }, { log: fakeLog() });
  assert.equal(multi.mode, '--multiarch');
}
console.log('   ✓ buildDevImage mode options');

console.log('31. buildDevImage invokes build script with bash');
{
  const logs = [];
  const spawnFn = (cmd, args) => {
    logs.push([cmd, ...args].join(' '));
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    setImmediate(() => {
      child.stdout.emit('data', Buffer.from('Built: ghcr.io/twilson63/hyperbeam-dev:latest\n'));
      child.emit('close', 0);
    });
    return child;
  };
  const log = fakeLog();
  const result = await buildDevImage({}, { spawnFn, log });
  assert.equal(result.ok, true);
  assert.ok(logs.some((k) => k.startsWith('bash ')));
  assert.ok(logs.some((k) => k.includes('build-dev-image.sh')));
  assert.ok(result.stdout.includes('Built:'));
}
console.log('   ✓ buildDevImage invokes script');

console.log('32. deployDev --build-image builds image before running');
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
    if (key.startsWith('bash')) {
      out = { code: 0, stdout: 'Built\n' };
    } else if (key.startsWith('docker run')) {
      out = { code: 0, stdout: 'abc123\n' };
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
  const metaInfo = { devices: { 'permabrain-consensus': {}, 'permabrain-query': {} } };
  const fetchFn = fakeFetch([{ ok: true, body: JSON.stringify(metaInfo) }]);
  const log = fakeLog();
  const result = await deployDev({ 'build-image': true }, { spawnFn, fetchFn, log });
  assert.equal(result.ok, true);
  assert.ok(logs.some((k) => k.startsWith('bash ')), 'build script ran');
  assert.ok(logs.some((k) => k.startsWith('docker run')), 'container ran');
  assert.ok(!logs.some((k) => k.startsWith('docker pull')), 'did not pull');
  assert.ok(!logs.some((k) => k.startsWith('docker images')), 'did not check local image');
}
console.log('   ✓ deployDev --build-image builds before running');

console.log('33. CLI build-dev-image --help works');
{
  const help = execSync(`node ${join(process.cwd(), 'scripts/cli.mjs')} build-dev-image --help`, {
    encoding: 'utf8',
  });
  assert.match(help, /build-dev-image/);
  assert.match(help, /--project-dir/);
  assert.match(help, /--version/);
  assert.match(help, /--push/);
  assert.match(help, /--multiarch/);
}
console.log('   ✓ build-dev-image CLI help works');

console.log('34. deploy-dev dry-run --build-image reports build plan');
{
  const log = fakeLog();
  const result = await deployDev({ 'dry-run': true, 'build-image': true }, { log });
  assert.equal(result.buildImage, true);
  assert.ok(log.output.some((line) => line.includes('Build image:  yes')));
}
console.log('   ✓ deploy-dev dry-run --build-image');

console.log('35. deployDev dry-run returns resolved command with actual values');
{
  const log = fakeLog();
  const result = await deployDev(
    { 'dry-run': true, image: 'my-image:tag', port: '9000', 'project-dir': 'hb-forge' },
    { log }
  );
  assert.equal(result.command, 'docker run -d --rm --name permabrain-dev-9000 -p 9000:8734 -v ' + result.projectDir + ':/work my-image:tag sh -c "cd /work && rebar3 device local"');
  assert.ok(result.command.includes('my-image:tag'), 'command includes image');
  assert.ok(result.command.includes('9000:8734'), 'command includes port mapping');
  assert.ok(result.command.includes(result.projectDir), 'command includes project dir');
  assert.ok(result.command.includes('permabrain-dev-9000'), 'command includes container name');
}
console.log('   ✓ dry-run resolved command');

console.log('✅ All deploy-dev tests passed');

console.log('36. restartDev dry-run prints stop + deploy plan');
{
  const log = fakeLog();
  const result = await restartDev({ 'dry-run': true, port: '9000' }, { log });
  assert.equal(result.action, 'restart-dev');
  assert.ok(Array.isArray(result.stopped));
  assert.ok(result.deploy.command.includes('permabrain-dev-9000'));
  assert.ok(log.output.some((line) => line.includes('Dry-run restart plan')));
  assert.ok(log.output.some((line) => line.includes('Would deploy:')));
}
console.log('   ✓ restartDev dry-run');

console.log('37. restartDev stops existing container then deploys');
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
    if (key === 'docker stop permabrain-dev-8734' || key === 'docker rm permabrain-dev-8734') {
      out = { code: 0, stdout: '' };
    } else if (key.startsWith('docker images')) {
      out = { code: 0, stdout: `${image}\n` };
    } else if (key.startsWith('docker run')) {
      out = { code: 0, stdout: 'new-container-id\n' };
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
  const metaInfo = { devices: { 'permabrain-consensus': {}, 'permabrain-query': {} } };
  const fetchFn = fakeFetch([{ ok: true, body: JSON.stringify(metaInfo) }]);
  const log = fakeLog();
  const result = await restartDev({ 'no-pull': true }, { spawnFn, fetchFn, log });
  assert.equal(result.restarted, true);
  assert.equal(result.ok, true);
  assert.ok(logs.includes('docker stop permabrain-dev-8734'));
  assert.ok(logs.includes('docker rm permabrain-dev-8734'));
  assert.ok(logs.some((k) => k.startsWith('docker run')));
  assert.equal(result.containerId, 'new-container-id');
}
console.log('   ✓ restartDev stop + deploy');

console.log('38. restartDev --no-pull skips image pull/check');
{
  const logs = [];
  const spawnFn = (cmd, args) => {
    const key = [cmd, ...args].join(' ');
    logs.push(key);
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    let out;
    if (key === 'docker stop permabrain-dev-8734' || key === 'docker rm permabrain-dev-8734') {
      out = { code: 0, stdout: '' };
    } else if (key.startsWith('docker run')) {
      out = { code: 0, stdout: 'cid\n' };
    } else {
      out = { code: 0, stdout: '' };
    }
    setImmediate(() => {
      if (out.stdout) child.stdout.emit('data', Buffer.from(out.stdout));
      child.emit('close', out.code ?? 0);
    });
    return child;
  };
  const fetchFn = fakeFetch([{ ok: true, body: JSON.stringify({ devices: { 'permabrain-consensus': {}, 'permabrain-query': {} } }) }]);
  await restartDev({ 'no-pull': true }, { spawnFn, fetchFn, log: fakeLog() });
  assert.ok(!logs.some((k) => k.startsWith('docker images')), 'no image check');
  assert.ok(!logs.some((k) => k.startsWith('docker pull')), 'no pull');
}
console.log('   ✓ restartDev --no-pull');

console.log('39. restartDev --json outputs JSON');
{
  const spawnFn = (cmd, args) => {
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    setImmediate(() => {
      if (cmd === 'docker' && args[0] === 'stop') child.stdout.emit('data', Buffer.from(''));
      child.emit('close', 0);
    });
    return child;
  };
  const log = fakeLog();
  const result = await restartDev({ 'dry-run': true, json: true, port: '7777' }, { spawnFn, log });
  assert.equal(result.action, 'restart-dev');
  assert.ok(log.output.some((line) => line.includes('"action"')));
}
console.log('   ✓ restartDev --json');

console.log('40. CLI restart-dev --help works');
{
  const help = execSync(`node ${join(process.cwd(), 'scripts/cli.mjs')} restart-dev --help`, {
    encoding: 'utf8',
  });
  assert.match(help, /restart-dev/);
  assert.match(help, /--no-pull/);
  assert.match(help, /--build-image/);
  assert.match(help, /--container-name/);
}
console.log('   ✓ restart-dev CLI help works');

console.log('✅ All restart-dev tests passed');

console.log('1. logsDev fetches tail logs by default');
{
  const logs = [];
  const spawnFn = (cmd, args) => {
    const key = [cmd, ...args].join(' ');
    logs.push(key);
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    assert.equal(cmd, 'docker');
    assert.deepEqual(args.slice(0, 3), ['logs', '--tail', '50']);
    assert.equal(args.at(-1), 'permabrain-dev-8734');
    setImmediate(() => {
      child.stdout.emit('data', Buffer.from('line1\nline2'));
      child.emit('close', 0);
    });
    return child;
  };
  const log = fakeLog();
  const result = await logsDev({}, { spawnFn, log });
  assert.equal(result.ok, true);
  assert.equal(result.name, 'permabrain-dev-8734');
  assert.equal(result.logs, 'line1\nline2');
  assert.ok(log.output.some((line) => line.includes('line1')));
}
console.log('   ✓ logsDev fetches tail logs');

console.log('2. logsDev --json outputs structured JSON');
{
  const spawnFn = (cmd, args) => {
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    setImmediate(() => {
      child.stdout.emit('data', Buffer.from('json-log'));
      child.emit('close', 0);
    });
    return child;
  };
  const log = fakeLog();
  const result = await logsDev({ port: '7777', json: true }, { spawnFn, log });
  assert.equal(result.name, 'permabrain-dev-7777');
  assert.equal(result.logs, 'json-log');
  assert.ok(log.output.some((line) => line.includes('"ok"')));
  assert.ok(log.output.some((line) => line.includes('json-log')));
}
console.log('   ✓ logsDev --json');

console.log('3. logsDev passes --timestamps and --since');
{
  const logs = [];
  const spawnFn = (cmd, args) => {
    logs.push(args);
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    setImmediate(() => {
      child.stdout.emit('data', Buffer.from(''));
      child.emit('close', 0);
    });
    return child;
  };
  await logsDev({ 'container-name': 'custom', timestamps: true, since: '5m' }, { spawnFn, log: fakeLog() });
  const expected = ['logs', '--tail', '50', '--timestamps', '--since', '5m', 'custom'];
  assert.deepEqual(logs[0], expected);
}
console.log('   ✓ logsDev timestamps + since');

console.log('4. logsDev reports clear error when container is missing');
{
  const spawnFn = (cmd, args) => {
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    setImmediate(() => {
      const err = new Error('spawn docker ENOENT');
      err.code = 'ENOENT';
      child.emit('error', err);
    });
    return child;
  };
  await assert.rejects(logsDev({}, { spawnFn, log: fakeLog() }), /Docker is not installed/);
}
console.log('   ✓ logsDev docker missing error');

console.log('5. logsDev reports clear error for missing container by name');
{
  const spawnFn = (cmd, args) => {
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    setImmediate(() => {
      child.stderr.emit('data', Buffer.from('Error: No such container: gone'));
      child.emit('close', 1, null);
    });
    return child;
  };
  await assert.rejects(
    logsDev({ 'container-name': 'gone' }, { spawnFn, log: fakeLog() }),
    /No dev container found: gone/
  );
}
console.log('   ✓ logsDev missing container');

console.log('6. streamLogs follow mode returns cancellable controller');
{
  let closed = false;
  const spawnFn = (cmd, args) => {
    assert.equal(cmd, 'docker');
    assert.deepEqual(args.slice(0, 2), ['logs', '-f']);
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.kill = (signal) => {
      child.emit('close', null, signal);
    };
    setImmediate(() => {
      child.stdout.emit('data', Buffer.from('followed\n'));
    });
    return child;
  };
  const log = fakeLog();
  const controller = streamLogs('permabrain-dev-8734', { spawnFn, log });
  assert.equal(controller.name, 'permabrain-dev-8734');
  assert.equal(typeof controller.cancel, 'function');
  controller.cancel();
  const result = await controller.wait();
  assert.equal(result.ok, true);
  assert.equal(result.cancelled, true);
  assert.equal(result.signal, 'SIGTERM');
}
console.log('   ✓ streamLogs controller');

console.log('7. logsDev --follow returns stream controller');
{
  const spawnFn = (cmd, args) => {
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.kill = (signal) => child.emit('close', null, signal);
    return child;
  };
  const log = fakeLog();
  const controller = await logsDev({ follow: true, 'container-name': 'c1' }, { spawnFn, log });
  assert.equal(controller.name, 'c1');
  controller.cancel();
  const result = await controller.wait();
  assert.equal(result.cancelled, true);
}
console.log('   ✓ logsDev follow mode');

console.log('8. CLI logs-dev --help works');
{
  const help = execSync(`node ${join(process.cwd(), 'scripts/cli.mjs')} logs-dev --help`, {
    encoding: 'utf8',
  });
  assert.match(help, /logs-dev/);
  assert.match(help, /--follow/);
  assert.match(help, /--timestamps/);
  assert.match(help, /--log-lines/);
}
console.log('   ✓ logs-dev CLI help works');

console.log('✅ All logs-dev tests passed');

console.log('1. execDev runs default rebar3 device list command');
{
  const logs = [];
  const spawnFn = (cmd, args) => {
    logs.push([cmd, ...args].join(' '));
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    setImmediate(() => {
      child.stdout.emit('data', Buffer.from('permabrain-consensus\npermabrain-query\n'));
      child.emit('close', 0);
    });
    return child;
  };
  const log = fakeLog();
  const result = await execDev({}, { spawnFn, log });
  assert.equal(result.ok, true);
  assert.deepEqual(result.command, ['rebar3', 'device', 'list']);
  assert.ok(logs[0].startsWith('docker exec permabrain-dev-8734 rebar3 device list'));
  assert.ok(log.output.some((line) => line.includes('permabrain-consensus')));
}
console.log('   ✓ execDev default command');

console.log('2. execDev runs a custom command with arguments');
{
  const logs = [];
  const spawnFn = (cmd, args) => {
    logs.push([cmd, ...args].join(' '));
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    setImmediate(() => {
      child.stdout.emit('data', Buffer.from('/work/src\n'));
      child.emit('close', 0);
    });
    return child;
  };
  const result = await execDev({ _: ['ls', '-la', '/work/src'] }, { spawnFn, log: fakeLog() });
  assert.deepEqual(result.command, ['ls', '-la', '/work/src']);
  assert.ok(logs[0].startsWith('docker exec permabrain-dev-8734 ls -la /work/src'));
}
console.log('   ✓ execDev custom command');

console.log('3. execDev honors --container-name, --work-dir, and --env');
{
  const logs = [];
  const spawnFn = (cmd, args) => {
    logs.push([cmd, ...args].join(' '));
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    setImmediate(() => {
      child.stdout.emit('data', Buffer.from('ok\n'));
      child.emit('close', 0);
    });
    return child;
  };
  const result = await execDev(
    {
      _: ['env'],
      'container-name': 'my-dev',
      'work-dir': '/work',
      env: ['DEBUG=1', 'FOO=bar'],
    },
    { spawnFn, log: fakeLog() }
  );
  const key = logs[0];
  assert.ok(key.startsWith('docker exec --workdir /work --env DEBUG=1 --env FOO=bar my-dev env'));
  assert.equal(result.name, 'my-dev');
  assert.equal(result.workdir, '/work');
  assert.deepEqual(result.env, ['DEBUG=1', 'FOO=bar']);
}
console.log('   ✓ execDev container/workdir/env options');

console.log('4. execDev returns structured JSON output');
{
  const spawnFn = (cmd, args) => {
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    setImmediate(() => {
      child.stdout.emit('data', Buffer.from('stdout-data'));
      child.stderr.emit('data', Buffer.from('stderr-data'));
      child.emit('close', 0);
    });
    return child;
  };
  const log = fakeLog();
  const result = await execDev({ _: ['cat'], json: true }, { spawnFn, log });
  assert.equal(result.ok, true);
  assert.equal(result.stdout, 'stdout-data');
  assert.equal(result.stderr, 'stderr-data');
  assert.ok(log.output[0].includes('"stdout": "stdout-data"'));
}
console.log('   ✓ execDev JSON output');

console.log('5. execDev surfaces clear error for missing container');
{
  const spawnFn = (cmd, args) => {
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    setImmediate(() => {
      child.stderr.emit('data', Buffer.from('Error response from daemon: No such container: permabrain-dev-8734\n'));
      child.emit('close', 1);
    });
    return child;
  };
  await assert.rejects(
    execDev({ _: ['ls'] }, { spawnFn, log: fakeLog() }),
    /No dev container found: permabrain-dev-8734/
  );
}
console.log('   ✓ execDev missing container error');

console.log('6. execDev surfaces docker-missing error');
{
  const spawnFn = () => {
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    setImmediate(() => child.emit('error', { code: 'ENOENT' }));
    return child;
  };
  await assert.rejects(
    execDev({ _: ['ls'] }, { spawnFn, log: fakeLog() }),
    /Docker is not installed/
  );
}
console.log('   ✓ execDev docker missing error');

console.log('7. CLI exec-dev --help works');
{
  const help = execSync('node scripts/cli.mjs exec-dev --help', {
    cwd: '/home/node/.openclaw/workspace/permabrain',
    encoding: 'utf8',
  });
  assert.match(help, /exec-dev/);
  assert.match(help, /--work-dir/);
  assert.match(help, /--env/);
  assert.match(help, /--json/);
}
console.log('   ✓ exec-dev CLI help works');

console.log('✅ All exec-dev tests passed');

console.log('1. watchDev reports healthy container immediately and exits after timeout');
{
  let calls = 0;
  const spawnFn = (cmd, args) => {
    const key = [cmd, ...args].join(' ');
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    if (key.startsWith('docker ps --format')) {
      calls += 1;
      setImmediate(() => {
        child.stdout.emit('data', Buffer.from('permabrain-dev-8734\t0.0.0.0:8734->8734/tcp\tUp\tabc123\n'));
        child.emit('close', 0);
      });
    } else {
      setImmediate(() => child.emit('close', 0));
    }
    return child;
  };
  const fetchFn = () => Promise.resolve({ ok: true, text: async () => '{"permabrain-consensus": true, "permabrain-query": true}' });
  const log = fakeLog();

  let intervals = [];
  const setIntervalFn = (fn, ms) => {
    const id = setInterval(fn, ms);
    intervals.push(id);
    return id;
  };
  const clearIntervalFn = (id) => {
    clearInterval(id);
    intervals = intervals.filter((i) => i !== id);
  };

  const result = await watchDev(
    { timeout: 1, interval: 100 },
    { spawnFn, fetchFn, log, setIntervalFn, clearIntervalFn, DateNow: Date.now }
  );
  assert.equal(result.ok, true);
  assert.equal(result.healthy, true);
  assert.equal(result.running, true);
  assert.ok(result.checks >= 1, 'at least one check');
  assert.ok(result.healthyChecks >= 1, 'at least one healthy check');
  assert.equal(result.unhealthyChecks, 0);
  assert.ok(log.output.some((line) => line.includes('Watching HyperBEAM dev container')));
}
console.log('   ✓ watchDev healthy immediate');

console.log('2. watchDev detects unhealthy container and restarts when --restart is set');
{
  let dockerCalls = [];
  let healthy = false;
  const spawnFn = (cmd, args) => {
    const key = [cmd, ...args].join(' ');
    dockerCalls.push(key);
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    if (key.startsWith('docker ps --format')) {
      setImmediate(() => {
        child.stdout.emit('data', Buffer.from('permabrain-dev-8734\t0.0.0.0:8734->8734/tcp\tUp\tabc123\n'));
        child.emit('close', 0);
      });
    } else if (key.startsWith('docker run')) {
      healthy = true;
      setImmediate(() => {
        child.stdout.emit('data', Buffer.from('new-id\n'));
        child.emit('close', 0);
      });
    } else {
      setImmediate(() => child.emit('close', 0));
    }
    return child;
  };
  const fetchFn = () => {
    if (healthy) {
      return Promise.resolve({ ok: true, text: async () => '{"permabrain-consensus": true, "permabrain-query": true}' });
    }
    return Promise.resolve({ ok: true, text: async () => '{"other-device": true}' });
  };

  let intervalCount = 0;
  let intervals = [];
  const setIntervalFn = (fn, ms) => {
    intervalCount += 1;
    const id = { _fn: fn, _ms: ms, _n: intervalCount };
    intervals.push(id);
    const run = async () => {
      await fn();
    };
    id._timer = setTimeout(run, ms);
    return id;
  };
  const clearIntervalFn = (id) => {
    clearTimeout(id._timer);
    intervals = intervals.filter((i) => i !== id);
  };

  const log = fakeLog();
  const result = await watchDev(
    { timeout: 1, interval: 100, restart: true },
    { spawnFn, fetchFn, log, setIntervalFn, clearIntervalFn, DateNow: Date.now }
  );
  assert.equal(result.ok, true);
  assert.equal(result.restart, true);
  assert.equal(result.healthy, true);
  assert.ok(dockerCalls.some((k) => k.startsWith('docker stop permabrain-dev-8734')), 'stopped container');
  assert.ok(dockerCalls.some((k) => k.startsWith('docker run')), 'restarted container');
  assert.ok(result.lastRestart, 'recorded restart time');
  assert.ok(result.checks >= 1, 'at least one check');
}
console.log('   ✓ watchDev restart on unhealthy');

console.log('3. watchDev --json outputs structured report');
{
  const spawnFn = (cmd, args) => {
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    if ([cmd, ...args].join(' ').startsWith('docker ps --format')) {
      setImmediate(() => {
        child.stdout.emit('data', Buffer.from('permabrain-dev-8734\t0.0.0.0:8734->8734/tcp\tUp\tabc123\n'));
        child.emit('close', 0);
      });
    } else {
      setImmediate(() => child.emit('close', 0));
    }
    return child;
  };
  const fetchFn = () => Promise.resolve({ ok: true, text: async () => '{"permabrain-consensus": true}' });
  const log = fakeLog();
  const result = await watchDev({ timeout: 1, json: true }, { spawnFn, fetchFn, log, DateNow: Date.now });
  assert.equal(result.ok, true);
  assert.ok(result.checks >= 1, 'at least one check');
  assert.ok(log.output.some((line) => line.includes('"checks"')));
  assert.ok(log.output.some((line) => line.includes('"healthy"')));
}
console.log('   ✓ watchDev --json');

console.log('4. watchDev rejects invalid interval');
{
  await assert.rejects(
    watchDev({ interval: 50 }, { DateNow: Date.now }),
    /Invalid interval/
  );
}
console.log('   ✓ watchDev invalid interval');

console.log('5. CLI watch-dev --help works');
{
  const help = execSync('node scripts/cli.mjs watch-dev --help', {
    cwd: '/home/node/.openclaw/workspace/permabrain',
    encoding: 'utf8',
  });
  assert.match(help, /watch-dev/);
  assert.match(help, /--interval/);
  assert.match(help, /--restart/);
  assert.match(help, /--timeout/);
}
console.log('   ✓ watch-dev CLI help works');

console.log('✅ All watch-dev tests passed');

console.log('1. waitDev reports healthy container immediately');
{
  let calls = 0;
  const spawnFn = (cmd, args) => {
    const key = [cmd, ...args].join(' ');
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    if (key.startsWith('docker ps --format')) {
      calls += 1;
      setImmediate(() => {
        child.stdout.emit('data', Buffer.from('permabrain-dev-8734\t0.0.0.0:8734->8734/tcp\tUp\tabc123\n'));
        child.emit('close', 0);
      });
    } else {
      setImmediate(() => child.emit('close', 0));
    }
    return child;
  };
  const fetchFn = () => Promise.resolve({ ok: true, text: async () => '{"permabrain-consensus": true, "permabrain-query": true}' });
  const log = fakeLog();
  const result = await waitDev({ timeout: 5000 }, { spawnFn, fetchFn, log, DateNow: Date.now });
  assert.equal(result.ok, true);
  assert.equal(result.healthy, true);
  assert.equal(result.running, true);
  assert.equal(result.port, 8734);
  assert.equal(result.name, 'permabrain-dev-8734');
  assert.equal(result.checks, 1);
  assert.ok(result.durationMs >= 0);
  assert.ok(log.output.some((line) => line.includes('is healthy after')));
}
console.log('   ✓ waitDev healthy immediate');

console.log('2. waitDev polls until container becomes healthy');
{
  let checks = 0;
  const spawnFn = (cmd, args) => {
    const key = [cmd, ...args].join(' ');
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    if (key.startsWith('docker ps --format')) {
      setImmediate(() => {
        child.stdout.emit('data', Buffer.from('permabrain-dev-8734\t0.0.0.0:8734->8734/tcp\tUp\tabc123\n'));
        child.emit('close', 0);
      });
    } else {
      setImmediate(() => child.emit('close', 0));
    }
    return child;
  };
  const fetchFn = () => {
    checks += 1;
    if (checks < 3) {
      return Promise.resolve({ ok: true, text: async () => '{"other-device": true}' });
    }
    return Promise.resolve({ ok: true, text: async () => '{"permabrain-consensus": true, "permabrain-query": true}' });
  };
  const log = fakeLog();
  const delays = [];
  const setTimeoutFn = (fn, ms) => {
    delays.push(ms);
    return setTimeout(fn, 1);
  };
  const result = await waitDev(
    { timeout: 5000, interval: 100 },
    { spawnFn, fetchFn, log, setTimeoutFn, DateNow: Date.now }
  );
  assert.equal(result.ok, true);
  assert.equal(result.healthy, true);
  assert.equal(result.checks, 3);
  assert.equal(delays.length, 2);
  assert.ok(delays.every((ms) => ms === 100));
}
console.log('   ✓ waitDev polls until healthy');

console.log('3. waitDev throws on timeout');
{
  const spawnFn = (cmd, args) => {
    const key = [cmd, ...args].join(' ');
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    if (key.startsWith('docker ps --format')) {
      setImmediate(() => {
        child.stdout.emit('data', Buffer.from('permabrain-dev-8734\t0.0.0.0:8734->8734/tcp\tUp\tabc123\n'));
        child.emit('close', 0);
      });
    } else {
      setImmediate(() => child.emit('close', 0));
    }
    return child;
  };
  const fetchFn = () => Promise.resolve({ ok: true, text: async () => '{"other-device": true}' });
  const log = fakeLog();
  const setTimeoutFn = (fn, ms) => setTimeout(fn, 1);
  await assert.rejects(
    waitDev({ timeout: 10, interval: 100 }, { spawnFn, fetchFn, log, setTimeoutFn, DateNow: Date.now }),
    /Timed out waiting for permabrain-consensus and permabrain-query/
  );
}
console.log('   ✓ waitDev timeout throws');

console.log('4. waitDev --exit-code returns non-zero result on timeout instead of throwing');
{
  const spawnFn = (cmd, args) => {
    const key = [cmd, ...args].join(' ');
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    if (key.startsWith('docker ps --format')) {
      setImmediate(() => {
        child.stdout.emit('data', Buffer.from('permabrain-dev-8734\t0.0.0.0:8734->8734/tcp\tUp\tabc123\n'));
        child.emit('close', 0);
      });
    } else {
      setImmediate(() => child.emit('close', 0));
    }
    return child;
  };
  const fetchFn = () => Promise.resolve({ ok: true, text: async () => '{"other-device": true}' });
  const log = fakeLog();
  const setTimeoutFn = (fn, ms) => setTimeout(fn, 1);
  const result = await waitDev(
    { timeout: 10, interval: 100, 'exit-code': true },
    { spawnFn, fetchFn, log, setTimeoutFn, DateNow: Date.now }
  );
  assert.equal(result.ok, false);
  assert.equal(result.healthy, false);
  assert.equal(result.running, true);
  assert.ok(result.error.includes('permabrain-consensus'));
}
console.log('   ✓ waitDev exit-code result');

console.log('5. waitDev --json outputs structured result');
{
  const spawnFn = (cmd, args) => {
    const key = [cmd, ...args].join(' ');
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    if (key.startsWith('docker ps --format')) {
      setImmediate(() => {
        child.stdout.emit('data', Buffer.from('permabrain-dev-8734\t0.0.0.0:8734->8734/tcp\tUp\tabc123\n'));
        child.emit('close', 0);
      });
    } else {
      setImmediate(() => child.emit('close', 0));
    }
    return child;
  };
  const fetchFn = () => Promise.resolve({ ok: true, text: async () => '{"permabrain-consensus": true, "permabrain-query": true}' });
  const log = fakeLog();
  const result = await waitDev({ json: true }, { spawnFn, fetchFn, log, DateNow: Date.now });
  assert.equal(result.ok, true);
  assert.ok(log.output.some((line) => line.includes('"healthy"')));
  assert.ok(log.output.some((line) => line.includes('"checks"')));
}
console.log('   ✓ waitDev JSON output');

console.log('6. waitDev --silent suppresses progress messages');
{
  const spawnFn = (cmd, args) => {
    const key = [cmd, ...args].join(' ');
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    if (key.startsWith('docker ps --format')) {
      setImmediate(() => {
        child.stdout.emit('data', Buffer.from('permabrain-dev-8734\t0.0.0.0:8734->8734/tcp\tUp\tabc123\n'));
        child.emit('close', 0);
      });
    } else {
      setImmediate(() => child.emit('close', 0));
    }
    return child;
  };
  let fetchCalls = 0;
  const fetchFn = () => {
    fetchCalls += 1;
    if (fetchCalls < 2) {
      return Promise.resolve({ ok: true, text: async () => '{"other-device": true}' });
    }
    return Promise.resolve({ ok: true, text: async () => '{"permabrain-consensus": true, "permabrain-query": true}' });
  };
  const log = fakeLog();
  const setTimeoutFn = (fn, ms) => setTimeout(fn, 1);
  const result = await waitDev(
    { timeout: 5000, interval: 100, silent: true },
    { spawnFn, fetchFn, log, setTimeoutFn, DateNow: Date.now }
  );
  assert.equal(result.ok, true);
  assert.ok(!log.output.some((line) => line.includes('Waiting for')));
  assert.ok(!log.output.some((line) => line.includes('running but not yet healthy')));
}
console.log('   ✓ waitDev silent mode');

console.log('7. waitDev rejects invalid interval');
{
  await assert.rejects(
    waitDev({ interval: 50 }, { DateNow: Date.now }),
    /Invalid interval/
  );
}
console.log('   ✓ waitDev invalid interval');

console.log('8. waitDev surfaces docker-missing error');
{
  const spawnFn = () => {
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    setImmediate(() => child.emit('error', { code: 'ENOENT' }));
    return child;
  };
  await assert.rejects(
    waitDev({}, { spawnFn, log: fakeLog(), DateNow: Date.now }),
    /Docker is not installed/
  );
}
console.log('   ✓ waitDev docker missing error');

console.log('9. CLI wait-dev --help works');
{
  const help = execSync('node scripts/cli.mjs wait-dev --help', {
    cwd: '/home/node/.openclaw/workspace/permabrain',
    encoding: 'utf8',
  });
  assert.match(help, /wait-dev/);
  assert.match(help, /--timeout/);
  assert.match(help, /--interval/);
  assert.match(help, /--exit-code/);
  assert.match(help, /--silent/);
  assert.match(help, /--json/);
}
console.log('   ✓ wait-dev CLI help works');

console.log('✅ All wait-dev tests passed');

console.log('1. checkDev reports ready when all required prerequisites are present');
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
    if (key === 'docker --version') {
      out = { code: 0, stdout: 'Docker version 24.0.7\n' };
    } else if (key === 'docker version --format {{.Server.Version}}') {
      out = { code: 0, stdout: '24.0.7\n' };
    } else if (key === 'docker buildx version') {
      out = { code: 0, stdout: 'github.com/docker/buildx v0.11.2\n' };
    } else if (key === 'rebar3 --version') {
      out = { code: 0, stdout: 'rebar 3.22.1 on Erlang/OTP 26\n' };
    } else if (key === 'erl +V') {
      out = { code: 0, stdout: '', stderr: 'Erlang (BEAM) emulator version 14.0\n' };
    } else if (key.startsWith('docker images')) {
      out = { code: 0, stdout: `${image}\n` };
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
  const log = fakeLog();
  const result = await checkDev(
    {},
    { spawnFn, log, processEnv: { GITHUB_TOKEN: 'token123' } }
  );
  assert.equal(result.ok, true);
  assert.equal(result.ready, true);
  assert.ok(result.checks.some((c) => c.name === 'Docker CLI' && c.ok));
  assert.ok(result.checks.some((c) => c.name === 'Docker daemon' && c.ok));
  assert.ok(result.checks.some((c) => c.name === 'GHCR write credentials' && c.source === 'GITHUB_TOKEN'));
  assert.ok(result.checks.some((c) => c.name === 'Dev image availability' && c.ok && c.source === 'local'));
  assert.ok(log.output.some((line) => line.includes('Dev-container environment is ready')));
}
console.log('   ✓ checkDev reports ready');

console.log('2. checkDev reports not ready when Docker is missing');
{
  const spawnFn = () => {
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    setImmediate(() => child.emit('error', { code: 'ENOENT' }));
    return child;
  };
  const log = fakeLog();
  const result = await checkDev({ 'exit-code': true }, { spawnFn, log, processEnv: {} });
  assert.equal(result.ok, false);
  assert.equal(result.ready, false);
  const dockerCli = result.checks.find((c) => c.name === 'Docker CLI');
  assert.equal(dockerCli.ok, false);
  assert.match(dockerCli.error, /not installed/);
}
console.log('   ✓ checkDev not ready with missing Docker');

console.log('3. checkDev --json outputs structured report');
{
  const image = 'ghcr.io/twilson63/hyperbeam-dev:latest';
  const spawnFn = (cmd, args) => {
    const key = [cmd, ...args].join(' ');
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    let out;
    if (key === 'docker --version') {
      out = { code: 0, stdout: 'Docker version 24.0.7\n' };
    } else if (key === 'docker version --format {{.Server.Version}}') {
      out = { code: 0, stdout: '24.0.7\n' };
    } else if (key.startsWith('docker images')) {
      out = { code: 0, stdout: `${image}\n` };
    } else {
      out = { code: 0, stdout: '' };
    }
    setImmediate(() => {
      if (out.stdout) child.stdout.emit('data', Buffer.from(out.stdout));
      child.emit('close', out.code ?? 0);
    });
    return child;
  };
  const log = fakeLog();
  const result = await checkDev({ json: true }, { spawnFn, log, processEnv: {} });
  assert.equal(result.ok, true);
  assert.ok(log.output.some((line) => line.includes('"ready"')));
  assert.ok(log.output.some((line) => line.includes('"checks"')));
}
console.log('   ✓ checkDev JSON output');

console.log('4. checkDev warns when optional tools are missing');
{
  const image = 'ghcr.io/twilson63/hyperbeam-dev:latest';
  const spawnFn = (cmd, args) => {
    const key = [cmd, ...args].join(' ');
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    let out;
    if (key === 'docker --version') {
      out = { code: 0, stdout: 'Docker version 24.0.7\n' };
    } else if (key === 'docker version --format {{.Server.Version}}') {
      out = { code: 0, stdout: '24.0.7\n' };
    } else if (key === 'docker buildx version' || key === 'rebar3 --version' || key === 'erl +V') {
      out = { code: 1, stdout: '', stderr: 'command not found' };
    } else if (key.startsWith('docker images')) {
      out = { code: 0, stdout: `${image}\n` };
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
  const log = fakeLog();
  const result = await checkDev({}, { spawnFn, log, processEnv: { CR_PAT: 'pat123' } });
  assert.equal(result.ok, true);
  assert.equal(result.ready, true);
  assert.equal(result.warnings.length, 3);
  assert.ok(result.warnings.some((w) => w.name === 'Docker Buildx'));
  assert.ok(result.warnings.some((w) => w.name === 'rebar3'));
  assert.ok(result.warnings.some((w) => w.name === 'Erlang/OTP (erl)'));
  assert.ok(log.output.some((line) => line.includes('Warnings (3)')));
}
console.log('   ✓ checkDev optional warnings');

console.log('5. CLI check-dev --help works');
{
  const help = execSync('node scripts/cli.mjs check-dev --help', {
    cwd: '/home/node/.openclaw/workspace/permabrain',
    encoding: 'utf8',
  });
  assert.match(help, /check-dev/);
  assert.match(help, /--project-dir/);
  assert.match(help, /--image/);
  assert.match(help, /--json/);
  assert.match(help, /--exit-code/);
}
console.log('   ✓ check-dev CLI help works');

console.log('✅ All check-dev tests passed');

console.log('1. verifyDev reports healthy when required devices are present');
{
  const containerName = 'permabrain-dev-8734';
  const spawnFn = (cmd, args) => {
    const key = [cmd, ...args].join(' ');
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    let out;
    if (key === `docker ps --format {{.Names}}\t{{.Ports}}\t{{.Status}}\t{{.ID}} --filter name=${containerName}`) {
      out = { code: 0, stdout: `${containerName}\t0.0.0.0:8734->8734/tcp\tUp 2 seconds\tabc123\n` };
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
  const result = await verifyDev({}, { spawnFn, fetchFn, log });
  assert.equal(result.ok, true);
  assert.equal(result.healthy, true);
  assert.equal(result.running, true);
  assert.deepEqual(result.devices, ['permabrain-consensus', 'permabrain-query']);
  assert.ok(log.output.some((line) => line.includes('verified')));
}
console.log('   ✓ verifyDev healthy');

console.log('2. verifyDev reports unhealthy when required devices are missing');
{
  const containerName = 'permabrain-dev-8734';
  const spawnFn = (cmd, args) => {
    const key = [cmd, ...args].join(' ');
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    let out;
    if (key === `docker ps --format {{.Names}}\t{{.Ports}}\t{{.Status}}\t{{.ID}} --filter name=${containerName}`) {
      out = { code: 0, stdout: `${containerName}\t0.0.0.0:8734->8734/tcp\tUp 2 seconds\tabc123\n` };
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
  const fetchFn = fakeFetch([{ ok: true, body: JSON.stringify({ devices: { other: {} } }) }]);
  const log = fakeLog();
  const result = await verifyDev({ 'exit-code': true }, { spawnFn, fetchFn, log });
  assert.equal(result.ok, false);
  assert.equal(result.healthy, false);
  assert.equal(result.running, true);
  assert.ok(result.error.includes('permabrain-consensus'));
}
console.log('   ✓ verifyDev unhealthy with exit-code');

console.log('3. verifyDev throws when container is not running');
{
  const containerName = 'permabrain-dev-8734';
  const spawnFn = (cmd, args) => {
    const key = [cmd, ...args].join(' ');
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    let out;
    if (key === `docker ps --format {{.Names}}\t{{.Ports}}\t{{.Status}}\t{{.ID}} --filter name=${containerName}`) {
      out = { code: 0, stdout: '' };
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
  const fetchFn = fakeFetch([]);
  const log = fakeLog();
  await assert.rejects(
    () => verifyDev({}, { spawnFn, fetchFn, log }),
    /No permabrain-dev container is running/
  );
}
console.log('   ✓ verifyDev throws when not running');

console.log('4. verifyDev JSON output');
{
  const containerName = 'permabrain-dev-9000';
  const spawnFn = (cmd, args) => {
    const key = [cmd, ...args].join(' ');
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    let out;
    if (key === `docker ps --format {{.Names}}\t{{.Ports}}\t{{.Status}}\t{{.ID}} --filter name=${containerName}`) {
      out = { code: 0, stdout: `${containerName}\t0.0.0.0:9000->8734/tcp\tUp 5 seconds\tabc123\n` };
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
  const fetchFn = fakeFetch([{ ok: true, body: JSON.stringify({ devices: { 'permabrain-consensus': {}, 'permabrain-query': {} } }) }]);
  const log = fakeLog();
  const result = await verifyDev({ port: 9000, json: true }, { spawnFn, fetchFn, log });
  assert.equal(result.ok, true);
  assert.equal(result.port, 9000);
  assert.ok(log.output.some((line) => line.includes('"ok": true')));
}
console.log('   ✓ verifyDev JSON output');

console.log('5. CLI verify-dev --help works');
{
  const help = execSync('node scripts/cli.mjs verify-dev --help', {
    cwd: '/home/node/.openclaw/workspace/permabrain',
    encoding: 'utf8',
  });
  assert.match(help, /verify-dev/);
  assert.match(help, /--container-name/);
  assert.match(help, /--json/);
  assert.match(help, /--exit-code/);
}
console.log('   ✓ verify-dev CLI help works');

console.log('✅ All verify-dev tests passed');

console.log('1. deployDev --tail streams logs while waiting and cancels on success');
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
      out = { code: 0, stdout: 'abc123def456\n' };
    } else if (key.startsWith('docker logs')) {
      out = { code: 0, stdout: '' };
      child.kill = (signal) => child.emit('close', null, signal);
    } else {
      out = { code: 0, stdout: '' };
    }
    setImmediate(() => {
      if (out.stderr) child.stderr.emit('data', Buffer.from(out.stderr));
      if (out.stdout) child.stdout.emit('data', Buffer.from(out.stdout));
      if (!key.startsWith('docker logs')) child.emit('close', out.code ?? 0);
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
  const result = await deployDev({ tail: true }, { spawnFn, fetchFn, log });
  assert.equal(result.ok, true);
  assert.equal(result.containerId, 'abc123def456');
  assert.ok(logs.some((k) => k.startsWith('docker logs')), 'started tail logs');
  assert.ok(logs.some((k) => k.startsWith('docker run')), 'ran container');
}
console.log('   ✓ deployDev --tail streams and cancels');

console.log('2. deployDev --tail is ignored when --json is set');
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
  const log = fakeLog();
  const result = await deployDev({ tail: true, json: true }, { spawnFn, fetchFn, log });
  assert.equal(result.ok, true);
  assert.ok(!logs.some((k) => k.startsWith('docker logs')), 'did not start tail logs with json');
  assert.ok(log.output.some((line) => line.includes('ignored when --json')));
}
console.log('   ✓ deployDev --tail ignored with --json');

console.log('✅ All deploy-dev tail tests passed');


