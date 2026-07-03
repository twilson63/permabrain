/**
 * Deploy the PermaBrain HyperBEAM Forge dev container locally.
 *
 * Wraps `docker run` for `ghcr.io/twilson63/hyperbeam-dev:latest`, starts
 * `rebar3 device local` on a host port, then polls `~meta@1.0/info` until the
 * PermaBrain devices (`permabrain-consensus` and `permabrain-query`) are
 * reported as loaded.
 */

import { spawn, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DEFAULT_IMAGE = 'ghcr.io/twilson63/hyperbeam-dev:latest';
const DEFAULT_PORT = 8734;
const DEFAULT_TIMEOUT_MS = 120_000;
const POLL_INTERVAL_MS = 1_000;
const DEFAULT_LOG_LINES = 50;

async function resolveProjectDir(input) {
  if (input) {
    const dir = path.resolve(input);
    if (!fs.existsSync(dir)) {
      throw new Error(`Project directory does not exist: ${dir}`);
    }
    return dir;
  }
  // Default to hb-forge under the repository root. Fall back to cwd/hb-forge
  // when the repo root cannot be determined.
  let root = process.cwd();
  try {
    root = execFileSync('git', ['rev-parse', '--show-toplevel'], {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'ignore'],
    }).trim();
  } catch {
    // ignore — use cwd
  }
  const dir = path.join(root, 'hb-forge');
  if (!fs.existsSync(dir)) {
    throw new Error(
      `Cannot find default hb-forge project directory at ${dir}. ` +
        `Use --project-dir to specify the Forge project path.`
    );
  }
  return dir;
}

function validateProjectDir(dir) {
  const required = ['rebar.config', 'src/permabrain.app.src'];
  const missing = required.filter((f) => !fs.existsSync(path.join(dir, f)));
  if (missing.length > 0) {
    throw new Error(
      `Project directory ${dir} does not look like a HyperBEAM Forge project. ` +
        `Missing: ${missing.join(', ')}`
    );
  }
}

function runProcess(cmd, args, { spawnFn = spawn, timeoutMs = 60_000 } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawnFn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    let timer;

    child.stdout.on('data', (data) => {
      stdout += data.toString();
    });
    child.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    if (timeoutMs > 0) {
      timer = setTimeout(() => {
        child.kill('SIGTERM');
        reject(new Error(`Command timed out after ${timeoutMs}ms: ${cmd} ${args.join(' ')}`));
      }, timeoutMs);
    }

    child.on('error', (err) => {
      clearTimeout(timer);
      if (err.code === 'ENOENT') {
        reject(new Error(`Docker is not installed or not on PATH: ${cmd}`));
      } else {
        reject(err);
      }
    });

    child.on('close', (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        reject(
          new Error(
            `Command failed with exit ${code}: ${cmd} ${args.join('\n')}\n${stderr || stdout}`.trim()
          )
        );
      } else {
        resolve({ stdout: stdout.trim(), stderr: stderr.trim() });
      }
    });
  });
}

export async function imageExists(image, deps = {}) {
  const { spawnFn = spawn } = deps;
  const repo = image.includes(':') ? image.split(':')[0] : image;
  try {
    const { stdout } = await runProcess(
      'docker',
      ['images', '--format', '{{.Repository}}:{{.Tag}}', repo],
      { spawnFn, timeoutMs: 30_000 }
    );
    return stdout.split(/\r?\n/).some((line) => line.trim() === image);
  } catch (err) {
    if (/Docker is not installed/.test(err.message)) throw err;
    return false;
  }
}

export async function pullImage(image, deps = {}) {
  const { spawnFn = spawn, log = console } = deps;
  log.log(`Pulling ${image}...`);
  const { stderr } = await runProcess('docker', ['pull', image], {
    spawnFn,
    timeoutMs: 300_000,
  });
  if (stderr) log.log(stderr);
  return true;
}

export async function containerLogs(name, { spawnFn = spawn, lines = DEFAULT_LOG_LINES } = {}) {
  const { stdout, stderr } = await runProcess(
    'docker',
    ['logs', '--tail', String(lines), name],
    { spawnFn, timeoutMs: 30_000 }
  );
  return { logs: stdout, stderr: stderr || '' };
}

function defaultContainerName(port) {
  return `permabrain-dev-${port}`;
}

export async function listPermabrainDevContainers(spawnFn = spawn) {
  const { stdout } = await runProcess(
    'docker',
    ['ps', '-a', '--format', '{{.Names}}', '--filter', 'name=permabrain-dev-'],
    { spawnFn, timeoutMs: 30_000 }
  );
  return stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((name) => name && name.startsWith('permabrain-dev-'));
}

export async function stopDev(args = {}, deps = {}) {
  const {
    spawnFn = spawn,
    log = console,
    processEnv = process.env,
  } = deps;

  const port = Number(args.port || args.p || DEFAULT_PORT);
  const nameArg = args['container-name'] || args.containerName;
  const all = args.all || false;
  const json = args.json || false;

  let names;
  if (all) {
    names = await listPermabrainDevContainers(spawnFn);
    if (names.length === 0) {
      const msg = 'No permabrain-dev-* containers found.';
      if (json) {
        log.log(JSON.stringify({ ok: true, stopped: [], message: msg }));
      } else {
        log.log(msg);
      }
      return { ok: true, stopped: [], message: msg };
    }
  } else {
    names = [nameArg || defaultContainerName(port)];
  }

  const stopped = [];
  const errors = [];
  for (const name of names) {
    try {
      await runProcess('docker', ['stop', name], { spawnFn, timeoutMs: 30_000 });
      stopped.push(name);
    } catch (err) {
      if (/No such container/.test(err.message)) {
        // Already gone; not an error.
      } else {
        errors.push({ name, error: err.message });
      }
    }
  }

  const removed = [];
  for (const name of stopped) {
    try {
      await runProcess('docker', ['rm', name], { spawnFn, timeoutMs: 30_000 });
      removed.push(name);
    } catch (err) {
      if (!/No such container|is not running/.test(err.message)) {
        errors.push({ name, error: err.message });
      }
    }
  }

  if (errors.length > 0) {
    const summary = errors.map((e) => `${e.name}: ${e.error}`).join('; ');
    throw new Error(`Failed to stop dev container(s): ${summary}`);
  }

  const result = {
    ok: true,
    stopped: removed,
    message: removed.length
      ? `Stopped and removed ${removed.join(', ')}`
      : `No running permabrain-dev container found for port ${port}.`,
  };

  if (json) {
    log.log(JSON.stringify(result, null, 2));
  } else {
    log.log(result.message);
  }

  return result;
}

export async function getDevContainerStatus(args = {}, deps = {}) {
  const { spawnFn = spawn, fetchFn = fetch, timeoutMs = 5_000 } = deps;
  const port = Number(args.port || args.p || DEFAULT_PORT);
  const nameArg = args['container-name'] || args.containerName;
  const name = nameArg || defaultContainerName(port);

  let container = null;
  try {
    const { stdout } = await runProcess(
      'docker',
      ['ps', '--format', '{{.Names}}\t{{.Ports}}\t{{.Status}}\t{{.ID}}', '--filter', `name=${name}`],
      { spawnFn, timeoutMs }
    );
    const lines = stdout.split(/\r?\n/).filter(Boolean);
    if (lines.length > 0) {
      const parts = lines[0].split('\t');
      container = {
        name: parts[0] || name,
        ports: parts[1] || '',
        status: parts[2] || '',
        id: parts[3] || '',
        port,
      };
    }
  } catch (err) {
    if (/Docker is not installed/.test(err.message)) throw err;
    // container stays null
  }

  let healthy = null;
  let info = null;
  if (container) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 2_000);
      const res = await fetchFn(`http://localhost:${port}/~meta@1.0/info`, {
        signal: controller.signal,
      });
      clearTimeout(timer);
      if (res.ok) {
        const text = await res.text();
        info = text;
        healthy = ['permabrain-consensus', 'permabrain-query'].every((device) =>
          text.includes(device)
        );
      } else {
        healthy = false;
      }
    } catch {
      healthy = false;
    }
  }

  return {
    ok: true,
    running: !!container,
    container,
    verifyUrl: `http://localhost:${port}/~meta@1.0/info`,
    healthy,
    info,
  };
}

export async function statusDev(args = {}, deps = {}) {
  const {
    spawnFn = spawn,
    fetchFn = fetch,
    log = console,
  } = deps;

  const all = args.all || false;
  const json = args.json || false;

  if (all) {
    const names = await listPermabrainDevContainers(spawnFn);
    const statuses = [];
    for (const name of names) {
      const s = await getDevContainerStatus({ 'container-name': name }, { spawnFn, fetchFn });
      statuses.push(s);
    }

    const result = {
      ok: true,
      running: statuses.length,
      total: statuses.length,
      containers: statuses,
    };

    if (json) {
      log.log(JSON.stringify(result, null, 2));
    } else if (statuses.length === 0) {
      log.log('No permabrain-dev-* containers are running.');
    } else {
      log.log(`${statuses.length} permabrain-dev container(s) running:`);
      for (const s of statuses) {
        const health = s.healthy === true ? 'healthy' : s.healthy === false ? 'unhealthy' : 'unknown';
        log.log(`  ${s.container.name} (port ${s.container.port}) — ${s.container.status} — ${health}`);
      }
    }
    return result;
  }

  const result = await getDevContainerStatus(args, { spawnFn, fetchFn });

  if (json) {
    log.log(JSON.stringify(result, null, 2));
  } else if (!result.running) {
    const port = Number(args.port || args.p || DEFAULT_PORT);
    log.log(`No permabrain-dev container is running for port ${port}.`);
  } else {
    const health = result.healthy === true ? 'healthy' : result.healthy === false ? 'unhealthy' : 'unknown';
    log.log(`HyperBEAM dev container ${result.container.name} is ${result.container.status}.`);
    log.log(`  Port:        ${result.container.port}`);
    log.log(`  Verify URL:  ${result.verifyUrl}`);
    log.log(`  Health:      ${health}`);
  }

  return result;
}

export async function runContainer({ image, port, projectDir, containerName }, deps = {}) {
  const { spawnFn = spawn } = deps;
  const name = containerName || `permabrain-dev-${port}`;
  const args = [
    'run',
    '-d',
    '--rm',
    '--name',
    name,
    '-p',
    `${port}:8734`,
    '-v',
    `${projectDir}:/work`,
    image,
    'sh',
    '-c',
    'cd /work && rebar3 device local',
  ];
  const { stdout } = await runProcess('docker', args, { spawnFn, timeoutMs: 60_000 });
  const containerId = stdout.split(/\r?\n/)[0].trim();
  if (!containerId) {
    throw new Error('docker run did not return a container id');
  }
  return { containerId, name };
}

export async function waitForDevices(url, requiredDevices, deps = {}) {
  const {
    fetchFn = fetch,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    intervalMs = POLL_INTERVAL_MS,
    log = console,
  } = deps;
  const deadline = Date.now() + timeoutMs;
  let lastError = null;
  let lastBody = null;

  while (Date.now() < deadline) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 2_000);
      const res = await fetchFn(url, { signal: controller.signal });
      clearTimeout(timer);
      if (!res.ok) {
        lastError = new Error(`HTTP ${res.status} from ${url}`);
      } else {
        const text = await res.text();
        lastBody = text;
        const found = requiredDevices.every((device) => text.includes(device));
        if (found) {
          let parsed;
          try {
            parsed = JSON.parse(text);
          } catch {
            parsed = { raw: text };
          }
          return { ok: true, devices: requiredDevices, info: parsed };
        }
        lastError = new Error(
          `Devices not yet loaded; missing one of ${requiredDevices.join(', ')}`
        );
      }
    } catch (err) {
      lastError = err;
    }
    log.log(`Waiting for HyperBEAM dev node at ${url}...`);
    await new Promise((r) => setTimeout(r, intervalMs));
  }

  throw new Error(
    `Timed out waiting for ${requiredDevices.join(' and ')} at ${url}. ` +
      `Last error: ${lastError?.message || 'unknown'}`
  );
}

export async function buildDevImage(args = {}, deps = {}) {
  const {
    spawnFn = spawn,
    log = console,
    processEnv = process.env,
  } = deps;

  const projectDir = await resolveProjectDir(args['project-dir'] || args.projectDir);
  validateProjectDir(projectDir);
  const version = args.version || args.tag || 'latest';
  const mode = args.push ? '--push' : args.multiarch ? '--multiarch' : '';
  const dryRun = args['dry-run'] || args.dryRun || false;
  const json = args.json || false;

  const scriptPath = path.join(projectDir, 'scripts', 'build-dev-image.sh');
  if (!fs.existsSync(scriptPath)) {
    throw new Error(`Forge build script not found at ${scriptPath}`);
  }

  const plan = {
    image: `ghcr.io/twilson63/hyperbeam-dev:${version}`,
    projectDir,
    script: scriptPath,
    mode,
    dryRun,
  };

  if (dryRun) {
    if (json) {
      log.log(JSON.stringify(plan, null, 2));
    } else {
      log.log('Dry-run plan:');
      log.log(`  Image:      ${plan.image}`);
      log.log(`  Project:    ${projectDir}`);
      log.log(`  Script:     ${scriptPath}`);
      log.log(`  Mode:       ${mode || 'local load'}`);
    }
    return plan;
  }

  const scriptArgs = [scriptPath, version];
  if (mode) scriptArgs.push(mode);

  log.log(`Building HyperBEAM dev image ${plan.image} from ${projectDir}...`);
  const { stdout, stderr } = await runProcess('bash', scriptArgs, {
    spawnFn,
    timeoutMs: 900_000,
  });

  const result = {
    ok: true,
    image: plan.image,
    projectDir,
    mode: mode || 'local load',
    stdout,
    stderr,
  };

  if (json) {
    log.log(JSON.stringify(result, null, 2));
  } else {
    log.log(`Built HyperBEAM dev image ${plan.image}`);
    if (stderr) log.log(stderr);
  }
  return result;
}

export async function restartDev(args = {}, deps = {}) {
  const {
    spawnFn = spawn,
    fetchFn = fetch,
    log = console,
    processEnv = process.env,
  } = deps;

  const port = Number(args.port || args.p || DEFAULT_PORT);
  const containerName = args['container-name'] || args.containerName || defaultContainerName(port);
  const dryRun = args['dry-run'] || args.dryRun || false;
  const json = args.json || false;

  // Forward deploy options. restart-dev accepts the union of deploy-dev and
  // stop-dev options, plus --no-pull to opt out of the default pull behavior.
  const deployArgs = {
    image: args.image,
    port: args.port || args.p,
    'project-dir': args['project-dir'] || args.projectDir,
    'container-name': args['container-name'] || args.containerName,
    timeout: args.timeout,
    'dry-run': dryRun,
    pull: args.pull || false,
    'no-pull': args['no-pull'] || args.noPull || false,
    'build-image': args['build-image'] || args.buildImage || false,
    logs: args.logs || false,
    'log-lines': args['log-lines'] || args.logLines,
    json,
  };

  // --no-pull means skip both forced and conditional pulls (useful when the
  // image is already known to exist and you want a fast restart).
  if (deployArgs['no-pull']) {
    deployArgs.pull = false;
  }

  if (dryRun) {
    const plan = {
      action: 'restart-dev',
      stopped: [containerName],
      deploy: await deployDev(deployArgs, {
        spawnFn,
        fetchFn,
        log: { log: () => {}, error: log.error || (() => {}) },
        processEnv,
      }),
    };
    if (json) {
      log.log(JSON.stringify(plan, null, 2));
    } else {
      log.log('Dry-run restart plan:');
      log.log(`  Would stop:   ${containerName}`);
      log.log(`  Would deploy: ${plan.deploy.command || plan.deploy.image}`);
    }
    return plan;
  }

  // Stop first, tolerating the case where Docker is not installed or nothing is
  // running. In either situation the deployment step is the one that matters.
  let stopped = [];
  try {
    const stopResult = await stopDev(args, {
      spawnFn,
      log: { log: () => {}, error: log.error || (() => {}) },
      processEnv,
    });
    stopped = stopResult.stopped || [];
  } catch (err) {
    if (!/Docker is not installed|not on PATH/.test(err.message)) {
      throw err;
    }
  }

  if (!deployArgs['no-pull'] && !deployArgs['build-image']) {
    deployArgs.pull = deployArgs.pull || false;
  }

  const result = await deployDev(deployArgs, { spawnFn, fetchFn, log, processEnv });
  return {
    ...result,
    restarted: true,
    stopped,
  };
}

export async function logsDev(args = {}, deps = {}) {
  const {
    spawnFn = spawn,
    log = console,
  } = deps;

  const port = Number(args.port || args.p || DEFAULT_PORT);
  const containerName = args['container-name'] || args.containerName || defaultContainerName(port);
  const lines = Number(args['log-lines'] || args.logLines || DEFAULT_LOG_LINES);
  const follow = args.follow || args.f || false;
  const since = args.since || null;
  const timestamps = args.timestamps || args.t || false;
  const json = args.json || false;

  if (json) {
    // JSON output cannot stream follow mode; force non-follow.
    if (follow) {
      log.error('Warning: --follow is not compatible with --json; fetching logs only.');
    }
  }

  if (follow && !json) {
    return streamLogs(containerName, { spawnFn, log, since, timestamps });
  }

  const dockerArgs = ['logs', '--tail', String(lines)];
  if (timestamps) dockerArgs.push('--timestamps');
  if (since) dockerArgs.push('--since', String(since));
  dockerArgs.push(containerName);

  let result;
  try {
    const { stdout, stderr } = await runProcess('docker', dockerArgs, {
      spawnFn,
      timeoutMs: 30_000,
    });
    result = { ok: true, name: containerName, logs: stdout, stderr: stderr || '' };
  } catch (err) {
    if (/No such container/.test(err.message)) {
      throw new Error(`No dev container found: ${containerName}`);
    }
    throw err;
  }

  if (json) {
    log.log(JSON.stringify(result, null, 2));
  } else {
    if (result.logs) log.log(result.logs);
    if (result.stderr) log.error(result.stderr);
  }

  return result;
}

export function streamLogs(name, { spawnFn = spawn, log = console, since = null, timestamps = false } = {}) {
  const args = ['logs', '-f'];
  if (timestamps) args.push('--timestamps');
  if (since) args.push('--since', String(since));
  args.push(name);

  const child = spawnFn('docker', args, { stdio: ['ignore', 'inherit', 'inherit'] });
  let running = true;
  let settled = null;
  const waiters = [];

  const settle = (value) => {
    if (settled) return;
    settled = value;
    running = false;
    while (waiters.length) {
      const { resolve, reject } = waiters.shift();
      if (value instanceof Error) reject(value);
      else resolve(value);
    }
  };

  child.on('error', (err) => settle(err));
  child.on('close', (code, signal) => {
    running = false;
    if (signal) {
      settle({ ok: true, name, cancelled: true, signal });
    } else if (code === 0 || code === null) {
      settle({ ok: true, name, cancelled: false, code });
    } else {
      settle(new Error(`docker logs -f exited with code ${code}`));
    }
  });

  const controller = {
    name,
    cancel: () => {
      if (running) {
        running = false;
        child.kill('SIGTERM');
      }
    },
    wait: () => {
      if (settled) {
        return settled instanceof Error
          ? Promise.reject(settled)
          : Promise.resolve(settled);
      }
      return new Promise((resolve, reject) => waiters.push({ resolve, reject }));
    },
  };

  log.log(`Following logs for ${name} (Ctrl+C to stop)...`);
  return controller;
}

export async function execDev(args = {}, deps = {}) {
  const { spawnFn = spawn, log = console } = deps;
  const port = Number(args.port || args.p || DEFAULT_PORT);
  const containerName =
    args['container-name'] || args.containerName || defaultContainerName(port);
  const json = args.json || false;
  const workdir = args['work-dir'] || args.workdir || args.wd || null;
  const envArgs = Array.isArray(args.env) ? args.env : args.env ? [args.env] : [];
  const command = (args._ && args._.length > 0) ? args._ : ['rebar3', 'device', 'list'];

  const dockerArgs = ['exec'];
  if (workdir) dockerArgs.push('--workdir', String(workdir));
  for (const e of envArgs) dockerArgs.push('--env', String(e));
  dockerArgs.push(containerName, ...command);

  try {
    const { stdout, stderr } = await runProcess('docker', dockerArgs, {
      spawnFn,
      timeoutMs: 60_000,
    });
    const result = {
      ok: true,
      name: containerName,
      command,
      workdir,
      env: envArgs,
      stdout,
      stderr: stderr || '',
    };
    if (json) {
      log.log(JSON.stringify(result, null, 2));
    } else {
      if (stdout) log.log(stdout);
      if (stderr) log.error(stderr);
    }
    return result;
  } catch (err) {
    if (/No such container/.test(err.message)) {
      throw new Error(`No dev container found: ${containerName}`);
    }
    if (/Docker is not installed/.test(err.message)) throw err;
    throw new Error(`exec failed in ${containerName}: ${err.message}`);
  }
}

export async function waitDev(args = {}, deps = {}) {
  const {
    spawnFn = spawn,
    fetchFn = fetch,
    log = console,
    DateNow = Date.now,
    setTimeoutFn = setTimeout,
  } = deps;

  const port = Number(args.port || args.p || DEFAULT_PORT);
  const containerName = args['container-name'] || args.containerName || defaultContainerName(port);
  const timeoutMs = Number(args.timeout || DEFAULT_TIMEOUT_MS);
  const intervalMs = Number(args.interval || args.i || POLL_INTERVAL_MS);
  const json = args.json || false;
  const exitCode = args['exit-code'] || args.exitCode || false;
  const silent = args.silent || false;
  const requiredDevices = ['permabrain-consensus', 'permabrain-query'];
  const verifyUrl = `http://localhost:${port}/~meta@1.0/info`;

  if (!Number.isInteger(intervalMs) || intervalMs < 100) {
    throw new Error(`Invalid interval: ${args.interval || args.i}. Must be at least 100ms.`);
  }

  const startedAt = DateNow();
  const deadline = timeoutMs > 0 ? startedAt + timeoutMs : 0;
  let checks = 0;
  let lastStatus = { running: false, healthy: false };
  let lastError = null;

  const emit = silent && !json ? () => {} : log.log.bind(log);
  emit(`Waiting for HyperBEAM dev container ${containerName} at ${verifyUrl}...`);

  const checkOnce = async () => {
    checks += 1;
    try {
      const status = await getDevContainerStatus(
        { port, 'container-name': containerName },
        { spawnFn, fetchFn }
      );
      lastStatus = status;
      return status;
    } catch (err) {
      lastError = err;
      if (/Docker is not installed/.test(err.message)) throw err;
      return { running: false, healthy: false };
    }
  };

  // Initial check.
  let status = await checkOnce();
  if (!status.healthy && status.running) {
    emit(`Container ${containerName} is running but not yet healthy; polling every ${intervalMs}ms...`);
  }

  while (!status.healthy) {
    if (deadline && DateNow() >= deadline) {
      const durationMs = DateNow() - startedAt;
      const result = {
        ok: false,
        name: containerName,
        port,
        verifyUrl,
        running: lastStatus.running,
        healthy: false,
        checks,
        durationMs,
        timeoutMs,
        error: lastError?.message || `Timed out waiting for ${requiredDevices.join(' and ')}`,
      };
      if (exitCode) {
        if (json) {
          log.log(JSON.stringify(result, null, 2));
        } else {
          log.error(`Wait timed out after ${durationMs}ms (${checks} check${checks === 1 ? '' : 's'}).`);
        }
        return result;
      }
      throw new Error(
        `Timed out waiting for ${requiredDevices.join(' and ')} in ${containerName} at ${verifyUrl} ` +
          `after ${timeoutMs}ms (${checks} check${checks === 1 ? '' : 's'}).`
      );
    }

    if (!silent) emit(`Waiting for HyperBEAM dev node at ${verifyUrl}...`);
    await new Promise((r) => setTimeoutFn(r, intervalMs));
    status = await checkOnce();
  }

  const durationMs = DateNow() - startedAt;
  const result = {
    ok: true,
    name: containerName,
    port,
    verifyUrl,
    running: true,
    healthy: true,
    checks,
    durationMs,
    devices: requiredDevices,
  };

  if (json) {
    log.log(JSON.stringify(result, null, 2));
  } else {
    emit(`Container ${containerName} is healthy after ${durationMs}ms (${checks} check${checks === 1 ? '' : 's'}).`);
  }

  return result;
}

export async function verifyDev(args = {}, deps = {}) {
  const {
    spawnFn = spawn,
    fetchFn = fetch,
    log = console,
  } = deps;

  const port = Number(args.port || args.p || DEFAULT_PORT);
  const containerName = args['container-name'] || args.containerName || defaultContainerName(port);
  const json = args.json || false;
  const exitCode = args['exit-code'] || args.exitCode || false;
  const requiredDevices = ['permabrain-consensus', 'permabrain-query'];
  const verifyUrl = `http://localhost:${port}/~meta@1.0/info`;

  const status = await getDevContainerStatus(
    { port, 'container-name': containerName },
    { spawnFn, fetchFn }
  );

  if (!status.running) {
    const result = {
      ok: false,
      name: containerName,
      port,
      verifyUrl,
      running: false,
      healthy: false,
      devices: requiredDevices,
      error: `No permabrain-dev container is running for port ${port}.`,
    };
    if (exitCode) {
      if (json) log.log(JSON.stringify(result, null, 2));
      else log.error(result.error);
      return result;
    }
    throw new Error(result.error);
  }

  const result = {
    ok: status.healthy === true,
    name: containerName,
    port,
    verifyUrl,
    running: true,
    healthy: status.healthy === true,
    devices: requiredDevices,
    info: status.info || null,
  };

  if (!result.ok) {
    result.error = `Container ${containerName} is running but does not report all required devices (${requiredDevices.join(', ')}).`;
    if (exitCode) {
      if (json) log.log(JSON.stringify(result, null, 2));
      else log.error(result.error);
      return result;
    }
    throw new Error(result.error);
  }

  if (json) {
    log.log(JSON.stringify(result, null, 2));
  } else {
    log.log(`Container ${containerName} is verified and healthy.`);
    log.log(`  Port:        ${port}`);
    log.log(`  Verify URL:  ${verifyUrl}`);
    log.log(`  Devices:     ${requiredDevices.join(', ')}`);
  }

  return result;
}

export async function watchDev(args = {}, deps = {}) {
  const {
    spawnFn = spawn,
    fetchFn = fetch,
    log = console,
    processEnv = process.env,
    setIntervalFn = setInterval,
    clearIntervalFn = clearInterval,
    DateNow = Date.now,
  } = deps;

  const port = Number(args.port || args.p || DEFAULT_PORT);
  const intervalMs = Number(args.interval || args.i || 30_000);
  const restart = args.restart || false;
  const timeoutMs = Number(args.timeout || 120_000);
  const json = args.json || false;
  const containerName = args['container-name'] || args.containerName || defaultContainerName(port);

  if (!Number.isInteger(intervalMs) || intervalMs < 100) {
    throw new Error(`Invalid interval: ${args.interval}. Must be at least 100ms.`);
  }

  const deadline = timeoutMs > 0 ? DateNow() + timeoutMs : 0;
  const history = [];
  let checks = 0;
  let healthyChecks = 0;
  let unhealthyChecks = 0;
  let lastRestart = null;

  log.log(`Watching HyperBEAM dev container ${containerName} every ${intervalMs}ms...`);

  const checkOnce = async () => {
    checks += 1;
    const status = await getDevContainerStatus(
      { port, 'container-name': containerName },
      { spawnFn, fetchFn }
    );
    const entry = {
      time: new Date().toISOString(),
      running: status.running,
      healthy: status.healthy,
    };
    history.push(entry);
    if (status.healthy) {
      healthyChecks += 1;
    } else if (status.running) {
      unhealthyChecks += 1;
    }
    return status;
  };

  // First check happens immediately.
  let lastStatus = await checkOnce();
  if (lastStatus.healthy) {
    log.log(`Container ${containerName} is healthy.`);
  } else if (!lastStatus.running) {
    log.log(`Container ${containerName} is not running.`);
  } else {
    log.log(`Container ${containerName} is running but unhealthy.`);
  }

  if (restart && !lastStatus.healthy) {
    log.log(`Health check failed; restarting ${containerName}...`);
    try {
      await restartDev(
        { port, 'container-name': containerName, 'no-pull': true, json: false },
        { spawnFn, fetchFn, log, processEnv }
      );
      lastRestart = new Date().toISOString();
      lastStatus = await checkOnce();
      if (lastStatus.healthy) {
        log.log(`Container ${containerName} is healthy after restart.`);
      }
    } catch (err) {
      log.error(`Restart failed: ${err.message}`);
    }
  }

  if (deadline && DateNow() >= deadline) {
    return finalizeWatch();
  }

  let timer = null;
  const finished = new Promise((resolve) => {
    timer = setIntervalFn(async () => {
      lastStatus = await checkOnce();
      if (!lastStatus.healthy && restart) {
        log.log(`Health check failed; restarting ${containerName}...`);
        try {
          await restartDev(
            { port, 'container-name': containerName, 'no-pull': true, json: false },
            { spawnFn, fetchFn, log, processEnv }
          );
          lastRestart = new Date().toISOString();
          // Re-check status after restart.
          lastStatus = await checkOnce();
        } catch (err) {
          log.error(`Restart failed: ${err.message}`);
        }
      }

      if (deadline && DateNow() >= deadline) {
        clearIntervalFn(timer);
        resolve();
      }
    }, intervalMs);
  });

  await finished;
  return finalizeWatch();

  function finalizeWatch() {
    const result = {
      ok: true,
      name: containerName,
      port,
      intervalMs,
      checks,
      healthyChecks,
      unhealthyChecks,
      restart,
      lastRestart,
      running: lastStatus.running,
      healthy: lastStatus.healthy,
      history: history.slice(-20),
    };
    if (json) {
      log.log(JSON.stringify(result, null, 2));
    } else {
      log.log(`Watched ${containerName} for ${checks} check(s).`);
      log.log(`  Running: ${result.running}`);
      log.log(`  Healthy: ${result.healthy}`);
      log.log(`  Healthy checks: ${healthyChecks}`);
      log.log(`  Unhealthy checks: ${unhealthyChecks}`);
      if (lastRestart) log.log(`  Last restart: ${lastRestart}`);
    }
    return result;
  }
}

export async function deployDev(args = {}, deps = {}) {
  const {
    spawnFn = spawn,
    fetchFn = fetch,
    log = console,
    processEnv = process.env,
  } = deps;

  const image = args.image || DEFAULT_IMAGE;
  const port = Number(args.port || args.p || DEFAULT_PORT);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`Invalid port: ${args.port}`);
  }
  const projectDir = await resolveProjectDir(args['project-dir'] || args.projectDir);
  validateProjectDir(projectDir);
  const timeoutMs = Number(args.timeout || DEFAULT_TIMEOUT_MS);
  const dryRun = args['dry-run'] || args.dryRun || false;
  const forcePull = args.pull || false;
  const json = args.json || false;
  const buildImage = args['build-image'] || args.buildImage || false;
  const enableLogs = args.logs || false;
  const logLines = Number(args['log-lines'] || args.logLines || DEFAULT_LOG_LINES);
  const containerName = args['container-name'] || args.containerName || `permabrain-dev-${port}`;
  const noPull = args['no-pull'] || args.noPull || false;
  let tail = args.tail || false;
  if (json && tail) {
    log.error('Warning: --tail is ignored when --json is set because it would interleave log output with JSON.');
    tail = false;
  }

  if (dryRun) {
    const resolvedCommand = [
      'docker run -d --rm',
      `--name ${containerName}`,
      `-p ${port}:8734`,
      `-v ${projectDir}:/work`,
      image,
      `sh -c "cd /work && rebar3 device local"`,
    ].join(' ');
    const plan = {
      image,
      port,
      projectDir,
      containerName,
      command: resolvedCommand,
      verifyUrl: `http://localhost:${port}/~meta@1.0/info`,
      requiredDevices: ['permabrain-consensus', 'permabrain-query'],
      buildImage,
      logs: enableLogs,
      logLines,
      tail,
    };
    if (json) {
      log.log(JSON.stringify(plan, null, 2));
    } else {
      log.log('Dry-run plan:');
      log.log(`  Image:        ${image}`);
      log.log(`  Port:         ${port}`);
      log.log(`  Project dir:  ${projectDir}`);
      log.log(`  Verify URL:   ${plan.verifyUrl}`);
      log.log(`  Command:      ${plan.command}`);
      if (buildImage) {
        log.log('  Build image:  yes (local build via build-dev-image)');
      } else if (noPull) {
        log.log('  Pull image:   no (using existing local image)');
      } else if (forcePull) {
        log.log('  Pull image:   yes');
      } else {
        log.log('  Pull image:   if not present locally');
      }
      if (tail) {
        log.log('  Tail logs:    yes (stream container logs while waiting)');
      }
    }
    return plan;
  }

  if (buildImage) {
    await buildDevImage({ 'project-dir': projectDir, json }, { spawnFn, log });
  } else if (!noPull && (forcePull || !(await imageExists(image, { spawnFn })))) {
    await pullImage(image, { spawnFn, log });
  }

  const { containerId, name } = await runContainer(
    { image, port, projectDir, containerName },
    { spawnFn }
  );

  const verifyUrl = `http://localhost:${port}/~meta@1.0/info`;
  const requiredDevices = ['permabrain-consensus', 'permabrain-query'];
  let verifyResult;
  let capturedLogs = null;
  let tailController = null;
  if (tail) {
    tailController = streamLogs(name, { spawnFn, log });
  }

  const stopTail = async () => {
    if (!tailController) return;
    tailController.cancel();
    try {
      await tailController.wait();
    } catch {
      // ignore — tail cancellation is best-effort
    }
  };

  try {
    verifyResult = await waitForDevices(verifyUrl, requiredDevices, {
      fetchFn,
      timeoutMs,
      log,
    });
  } catch (err) {
    await stopTail();
    log.error(`Deployment failed: ${err.message}`);
    log.error(`Container ${containerId} (${name}) may still be running for inspection.`);
    if (enableLogs) {
      try {
        capturedLogs = await containerLogs(name, { spawnFn, lines: logLines });
        if (capturedLogs.logs) log.error('Recent container logs:\n' + capturedLogs.logs);
      } catch (logErr) {
        log.error(`Could not fetch container logs: ${logErr.message}`);
      }
    }
    const enriched = new Error(err.message);
    enriched.containerId = containerId;
    enriched.containerName = name;
    enriched.verifyUrl = verifyUrl;
    enriched.logs = capturedLogs?.logs || null;
    throw enriched;
  }

  await stopTail();

  const result = {
    ok: true,
    image,
    port,
    projectDir,
    containerId,
    containerName: name,
    verifyUrl,
    devices: requiredDevices,
    info: verifyResult.info,
  };

  if (json) {
    log.log(JSON.stringify(result, null, 2));
  } else {
    log.log('HyperBEAM dev container deployed and verified.');
    log.log(`  Container:    ${containerId}`);
    log.log(`  Name:         ${name}`);
    log.log(`  Port:         ${port}`);
    log.log(`  Verify URL:   ${verifyUrl}`);
    log.log(`  Devices:      ${requiredDevices.join(', ')}`);
    if (enableLogs) {
      try {
        const { logs: tail } = await containerLogs(name, { spawnFn, lines: logLines });
        result.logs = tail;
      } catch (logErr) {
        log.error(`Could not fetch container logs: ${logErr.message}`);
      }
    }
  }

  return result;
}

export async function checkDev(args = {}, deps = {}) {
  const {
    spawnFn = spawn,
    log = console,
    processEnv = process.env,
  } = deps;

  const json = args.json || false;
  const exitCode = args['exit-code'] || args.exitCode || false;
  const image = args.image || DEFAULT_IMAGE;
  const port = Number(args.port || args.p || DEFAULT_PORT);

  let projectDir;
  let projectCheck;
  try {
    projectDir = await resolveProjectDir(args['project-dir'] || args.projectDir);
    validateProjectDir(projectDir);
    projectCheck = {
      name: 'Forge project directory',
      ok: true,
      required: true,
      projectDir,
    };
  } catch (err) {
    projectCheck = {
      name: 'Forge project directory',
      ok: false,
      required: true,
      error: err.message,
    };
  }

  async function runCheck(cmd, args, { name, required = true, parse } = {}) {
    try {
      const { stdout, stderr } = await runProcess(cmd, args, { spawnFn, timeoutMs: 15_000 });
      if (parse) {
        return parse(stdout, stderr);
      }
      return { name, ok: true, required, stdout: stdout.trim() };
    } catch (err) {
      if (/Docker is not installed/.test(err.message)) {
        return { name: name || 'Docker CLI', ok: false, required, error: 'Docker CLI is not installed or not on PATH' };
      }
      return { name, ok: false, required, error: err.message };
    }
  }

  const dockerCli = await runCheck('docker', ['--version'], {
    name: 'Docker CLI',
    required: true,
    parse: (stdout) => ({ name: 'Docker CLI', ok: true, required: true, version: stdout.trim() }),
  });

  const dockerDaemon = await runCheck('docker', ['version', '--format', '{{.Server.Version}}'], {
    name: 'Docker daemon',
    required: true,
    parse: (stdout, stderr) => {
      const version = stdout.trim();
      if (!version) {
        return { name: 'Docker daemon', ok: false, required: true, error: stderr || 'Docker daemon did not report a version' };
      }
      return { name: 'Docker daemon', ok: true, required: true, version };
    },
  });

  const dockerBuildx = await runCheck('docker', ['buildx', 'version'], {
    name: 'Docker Buildx',
    required: false,
    parse: (stdout) => ({ name: 'Docker Buildx', ok: true, required: false, version: stdout.trim() }),
  });

  const rebar3 = await runCheck('rebar3', ['--version'], {
    name: 'rebar3',
    required: false,
    parse: (stdout) => ({ name: 'rebar3', ok: true, required: false, version: stdout.trim().split('\n')[0] }),
  });

  const erl = await runCheck('erl', ['+V'], {
    name: 'Erlang/OTP (erl)',
    required: false,
    parse: (stdout, stderr) => {
      const text = stdout || stderr || '';
      const first = text.trim().split('\n')[0];
      return { name: 'Erlang/OTP (erl)', ok: true, required: false, version: first };
    },
  });

  let ghcr = { name: 'GHCR write credentials', ok: false, required: false, error: 'No GHCR credential env var (GITHUB_TOKEN or CR_PAT) set' };
  if (processEnv.GITHUB_TOKEN || processEnv.CR_PAT) {
    ghcr = { name: 'GHCR write credentials', ok: true, required: false, source: processEnv.GITHUB_TOKEN ? 'GITHUB_TOKEN' : 'CR_PAT' };
  }

  let imageCheck = { name: 'Dev image availability', ok: false, required: false, error: 'Skipped image check' };
  if (dockerCli.ok && dockerDaemon.ok) {
    try {
      const exists = await imageExists(image, { spawnFn });
      if (exists) {
        imageCheck = { name: 'Dev image availability', ok: true, required: false, source: 'local', image };
      } else {
        imageCheck = {
          name: 'Dev image availability',
          ok: false,
          required: false,
          source: 'local',
          image,
          error: `Image ${image} is not present locally. Run 'permabrain deploy-dev' to pull it.`,
        };
      }
    } catch (err) {
      imageCheck = { name: 'Dev image availability', ok: false, required: false, image, error: err.message };
    }
  }

  const checks = [projectCheck, dockerCli, dockerDaemon, dockerBuildx, rebar3, erl, ghcr, imageCheck];
  const requiredReady = checks.filter((c) => c.required).every((c) => c.ok);
  const warnings = checks.filter((c) => !c.required && !c.ok);
  const ready = requiredReady;

  const result = {
    ok: ready,
    ready,
    image,
    port,
    projectDir: projectDir || null,
    checks,
    warnings: warnings.map((w) => ({ name: w.name, error: w.error })),
    summary: ready
      ? 'Dev-container environment is ready.'
      : 'Dev-container environment is missing required prerequisites.',
  };

  if (!ready && !exitCode) {
    const failed = checks.filter((c) => c.required && !c.ok).map((c) => `${c.name}: ${c.error}`).join('; ');
    const err = new Error(`Dev-container prerequisites not met: ${failed}`);
    err.checkResult = result;
    throw err;
  }

  if (json) {
    log.log(JSON.stringify(result, null, 2));
  } else {
    log.log('HyperBEAM Forge dev-container prerequisites:');
    for (const check of checks) {
      const symbol = check.ok ? '✓' : '✗';
      const required = check.required ? 'required' : 'optional';
      log.log(`  ${symbol} ${check.name} (${required})`);
      if (check.version) log.log(`    ${check.version}`);
      if (check.error) log.log(`    ${check.error}`);
      if (check.source && !check.error) log.log(`    source: ${check.source}`);
    }
    if (result.warnings.length > 0) {
      log.log(`\nWarnings (${result.warnings.length}):`);
      for (const w of result.warnings) {
        log.log(`  - ${w.name}: ${w.error}`);
      }
    }
    log.log(`\n${result.summary}`);
  }

  return result;
}
