import { Daytona } from '@daytona/sdk';
const daytona = new Daytona();
const sb = await daytona.get('b8625c83-5123-4265-93e6-b80894973f20');
try { await sb.start(); } catch {}
const r = await sb.process.executeCommand(`cd /tmp/HyperBEAM/_build/default/rel/hb && grep -i "config\|codec\|default" log/erlang.log.1 | head -40`, undefined, undefined, 60);
console.log(r.result);
