import { Daytona } from '@daytona/sdk';
import fs from 'node:fs';
const daytona = new Daytona();
const sb = await daytona.get('b8625c83-5123-4265-93e6-b80894973f20');
try { await sb.start(); } catch {}

const HB_DIR = '/tmp/HyperBEAM';
const REL_DIR = `${HB_DIR}/_build/default/rel/hb`;

const config = `port: 8734\ndefault_codec: json@1.0\n`;

async function run(cmd, timeout = 30) {
  const r = await sb.process.executeCommand(cmd, undefined, undefined, timeout);
  if (r.exitCode !== 0) throw new Error(`Exit ${r.exitCode}: ${cmd}\n${r.result}`);
  return r.result;
}

// Stop any running node
await run('pkill -f "hb daemon" 2>/dev/null || true; pkill -9 -f "beam.smp" 2>/dev/null || true; sleep 2; echo stopped', 30);

// Write config.flat into release dir
const b64 = Buffer.from(config).toString('base64');
await run(`echo '${b64}' | base64 -d > ${REL_DIR}/config.flat`, 30);

// Verify git commit
const commit = await run(`cd ${HB_DIR} && git rev-parse --short HEAD`, 30);
console.log('HyperBEAM commit:', commit.trim());

// Start daemon from release dir so it picks up config.flat
await run(`cd ${REL_DIR} && ./bin/hb daemon > /tmp/hb-daemon.log 2>&1 &`, 30);
await run('sleep 10', 15);

// Health check from inside sandbox (no Accept header needed now)
const health = await run(`curl -s http://localhost:8734/~meta@1.0/info | head -c 300`, 30);
console.log('Health:', health);

// Get signed preview URL
const preview = await sb.getSignedPreviewUrl(8734);
console.log('Signed preview URL:', preview.url);

// Write URL to a file for tests
fs.writeFileSync('/home/node/.openclaw/workspace/.hb-edge-url', preview.url);
