import { Daytona } from '@daytona/sdk';
const daytona = new Daytona();
const sb = await daytona.get('b8625c83-5123-4265-93e6-b80894973f20');
try { await sb.start(); } catch {}

async function run(cmd, timeout = 60) {
  const r = await sb.process.executeCommand(cmd, undefined, undefined, timeout);
  console.log(`[${r.exitCode}] ${cmd}\n${r.result}`);
  if (r.exitCode !== 0) throw new Error(`Command failed: ${cmd}`);
  return r;
}

// Stop the existing release node properly
await run('/tmp/HyperBEAM/_build/default/rel/hb/bin/hb stop || true', 60);
await run('pkill -f "run_erl" 2>/dev/null || true; pkill -9 -f "beam.smp" 2>/dev/null || true; sleep 3; ps aux | grep -E "beam|run_erl" | grep -v grep || echo "no beam"', 30);

// Create a symlink so the release sees the preloaded store at the expected relative path
await run('mkdir -p /tmp/HyperBEAM/_build/default/rel/hb/_build && ln -sf /tmp/HyperBEAM/_build/preloaded-store /tmp/HyperBEAM/_build/default/rel/hb/_build/preloaded-store && ls -la /tmp/HyperBEAM/_build/default/rel/hb/_build/', 30);

// Start from release dir (daemon persists)
await run('cd /tmp/HyperBEAM/_build/default/rel/hb && ./bin/hb daemon', 30);
await run('sleep 6; ps aux | grep -E "beam|run_erl" | grep -v grep', 30);

// Verify device endpoints
await run(`curl -s -H 'Accept: application/json' http://localhost:8734/~meta@1.0/info | head -c 200`, 30);
const bundlerOpts = await run(`curl -s -o /dev/null -w '%{http_code}' -H 'Accept: application/json' -X OPTIONS http://localhost:8734/~bundler@1.0/tx`, 30);
console.log('bundler OPTIONS status:', bundlerOpts.result.trim());
