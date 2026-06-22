import { Daytona } from '@daytona/sdk';
const daytona = new Daytona();
const sb = await daytona.get('b8625c83-5123-4265-93e6-b80894973f20');
try { await sb.start(); } catch(e) {}
const r = await sb.process.executeCommand('cat /tmp/HyperBEAM/_build/default/rel/hb/log/run_erl.log; echo ---; cat /tmp/HyperBEAM/_build/default/rel/hb/log/erlang.log.1 | tail -100', undefined, undefined, 30);
console.log(r.result);
