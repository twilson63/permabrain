import { Daytona } from '@daytona/sdk';
const daytona = new Daytona();
const sb = await daytona.get('b8625c83-5123-4265-93e6-b80894973f20');
try { await sb.start(); } catch {}

async function run(cmd, timeout = 60) {
  const r = await sb.process.executeCommand(cmd, undefined, undefined, timeout);
  if (r.exitCode !== 0) throw new Error(`Exit ${r.exitCode}: ${cmd}\n${r.result}`);
  return r.result;
}

await run('pkill -f "hb daemon" 2>/dev/null || true; pkill -9 -f "beam.smp" 2>/dev/null || true; sleep 2; echo stopped', 30);

// Start from /tmp/HyperBEAM so relative preloaded-store path resolves
await run('cd /tmp/HyperBEAM && _build/default/rel/hb/bin/hb daemon > /tmp/hb-daemon.log 2>&1 &', 30);
await run('sleep 8', 10);

// Test meta
const meta = await run(`curl -s -H 'Accept: application/json' http://localhost:8734/~meta@1.0/info | head -c 200`, 30);
console.log('meta:', meta);

// Test bundler options
const opts = await run(`curl -s -H 'Accept: application/json' -X OPTIONS http://localhost:8734/~bundler@1.0/tx | head -c 100`, 30);
console.log('bundler options:', opts);
