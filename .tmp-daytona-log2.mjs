import { Daytona } from '@daytona/sdk';
const daytona = new Daytona();
const sb = await daytona.get('b8625c83-5123-4265-93e6-b80894973f20');
try { await sb.start(); } catch(e) {}
const r = await sb.process.executeCommand('ps aux | grep -E "hb daemon|beam.smp" | grep -v grep || true; echo ---LOG-TAIL---; cat /tmp/hb-daemon.log | tail -80; echo ---RUN_ERL---; cat /tmp/HyperBEAM/_build/default/rel/hb/log/run_erl.log 2\u003e/dev/null | tail -20; echo ---ERLANG-LOG---; cat /tmp/HyperBEAM/_build/default/rel/hb/log/erlang.log.1 2\u003e/dev/null | tail -80', undefined, undefined, 30);
console.log(r.result);
