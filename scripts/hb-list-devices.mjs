import { Daytona } from '@daytona/sdk';
const daytona = new Daytona();
const sb = await daytona.get('b8625c83-5123-4265-93e6-b80894973f20');
try { await sb.start(); } catch {}

async function run(cmd, timeout = 60) {
  const r = await sb.process.executeCommand(cmd, undefined, undefined, timeout);
  console.log(`[${r.exitCode}] ${cmd}\n${r.result}`);
  return r;
}

// Try to call hb:preloaded_devices/0 or similar via rpc
await run('cd /tmp/HyperBEAM/_build/default/rel/hb && ./bin/hb rpc "io:format(~p, [maps:keys(element(2, hb_store:read_range(<<\\"cJgghPdg9XApjS-GW0dr8t64ZRFZUKMwP0rgZu-iMAM\\">>)))]" 2>&1 | tail -20', 60);
