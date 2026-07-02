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
      } else if (forcePull) {
        log.log('  Pull image:   yes');
      } else {
        log.log('  Pull image:   if not present locally');
      }
    }
    return plan;
  }

  if (buildImage) {
    await buildDevImage({ 'project-dir': projectDir, json }, { spawnFn, log });
  } else if (forcePull || !(await imageExists(image, { spawnFn }))) {
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
  try {
    verifyResult = await waitForDevices(verifyUrl, requiredDevices, {
      fetchFn,
      timeoutMs,
      log,
    });
  } catch (err) {
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
