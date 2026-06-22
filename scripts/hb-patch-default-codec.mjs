import { Daytona } from '@daytona/sdk';
const daytona = new Daytona();
const sb = await daytona.get('b8625c83-5123-4265-93e6-b80894973f20');
try { await sb.start(); } catch {}

async function run(cmd, timeout = 60) {
  const r = await sb.process.executeCommand(cmd, undefined, undefined, timeout);
  if (r.exitCode !== 0) throw new Error(`Exit ${r.exitCode}: ${cmd}\n${r.result}`);
  return r.result;
}

// Stop node
await run('pkill -f "hb daemon" 2>/dev/null || true; pkill -9 -f "beam.smp" 2>/dev/null || true; sleep 2; echo stopped', 30);

// Patch default codec in hb_http.erl
const file = '/tmp/HyperBEAM/src/core/http/hb_http.erl';
await run(`sed -i 's/hb_opts:get(default_codec, <<"httpsig@1.0">>, Opts)/hb_opts:get(default_codec, <<"json@1.0">>, Opts)/' ${file}`, 30);
await run(`grep -n "default_codec" ${file} | tail -5`, 30);

// Rebuild
await run('cd /tmp/HyperBEAM && source $HOME/.cargo/env && CFLAGS="-O2 -Wno-error=incompatible-pointer-types" rebar3 compile 2>&1 | tail -50', 1800);
await run('cd /tmp/HyperBEAM && source $HOME/.cargo/env && CFLAGS="-O2 -Wno-error=incompatible-pointer-types" rebar3 release 2>&1 | tail -30', 600);

// Start node
const REL_DIR = '/tmp/HyperBEAM/_build/default/rel/hb';
await run(`cd ${REL_DIR} && ./bin/hb daemon > /tmp/hb-daemon.log 2>&1 &`, 30);
await run('sleep 10', 15);

// Health check
const health = await run('curl -s http://localhost:8734/~meta@1.0/info | head -c 200', 30);
console.log('Health (should be JSON):', health);
