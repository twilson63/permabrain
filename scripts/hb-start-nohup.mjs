import { Daytona } from '@daytona/sdk';
const daytona = new Daytona();
const sb = await daytona.get('b8625c83-5123-4265-93e6-b80894973f20');
try { await sb.start(); } catch {}

async function run(cmd, timeout = 60) {
  const r = await sb.process.executeCommand(cmd, undefined, undefined, timeout);
  console.log(`[${r.exitCode}] ${cmd}\n${r.result}`);
  return r;
}

await run('pkill -f "hb daemon" 2>/dev/null || true; pkill -9 -f "beam.smp" 2>/dev/null || true; sleep 2; echo stopped', 30);
await run('cd /tmp/HyperBEAM && nohup _build/default/rel/hb/bin/hb daemon >/tmp/hb-daemon.log 2>&1 </dev/null & disown; sleep 6; ps aux | grep beam | grep -v grep', 30);
await run('cat /tmp/hb-daemon.log | tail -20', 30);
await run(`curl -s -H 'Accept: application/json' http://localhost:8734/~meta@1.0/info | head -c 200`, 30);
