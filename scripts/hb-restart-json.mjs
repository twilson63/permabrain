import { Daytona } from '@daytona/sdk';
import fs from 'node:fs';
const daytona = new Daytona();
const sb = await daytona.get('b8625c83-5123-4265-93e6-b80894973f20');
try { await sb.start(); } catch {}

const HB_DIR = '/tmp/HyperBEAM';
const REL_DIR = `${HB_DIR}/_build/default/rel/hb`;
const CONFIG_PATH = `${REL_DIR}/config.flat`;

const config = `port: 8734\ndefault-codec: json@1.0\n`;

async function run(cmd, timeout = 30) {
  const r = await sb.process.executeCommand(cmd, undefined, undefined, timeout);
  if (r.exitCode !== 0) throw new Error(`Exit ${r.exitCode}: ${cmd}\n${r.result}`);
  return r.result;
}

// Stop node
await run('pkill -f "hb daemon" 2>/dev/null || true; pkill -9 -f "beam.smp" 2>/dev/null || true; sleep 2; echo stopped', 30);

// Write config.flat with absolute path known
const b64 = Buffer.from(config).toString('base64');
await run(`echo '${b64}' | base64 -d > ${CONFIG_PATH}`, 30);
await run(`echo 'HB_CONFIG=${CONFIG_PATH}' > ${REL_DIR}/.hb-env; echo 'HB_PORT=8734' >> ${REL_DIR}/.hb-env`, 30);

// Start daemon with env
await run(`cd ${REL_DIR} && (export HB_CONFIG=${CONFIG_PATH}; export HB_PORT=8734; ./bin/hb daemon > /tmp/hb-daemon.log 2>&1 &)`, 30);
await run('sleep 12', 15);

// Health check from inside sandbox
const health = await run(`curl -s http://localhost:8734/~meta@1.0/info | head -c 200`, 30);
console.log('Health:', health);

// Health from host via signed URL
const preview = await sb.getSignedPreviewUrl(8734);
fs.writeFileSync('/home/node/.openclaw/workspace/.hb-edge-url', preview.url);
const { spawnSync } = await import('node:child_process');
const r = spawnSync('curl', ['-s', 'http://localhost:8734/~meta@1.0/info'], { encoding: 'utf8' });
console.log('host localhost:', r.stdout.slice(0,200));

const r2 = spawnSync('curl', ['-s', `${preview.url}/~meta@1.0/info`], { encoding: 'utf8' });
console.log('host signed url:', r2.stdout.slice(0,200));
