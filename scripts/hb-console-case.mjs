import { Daytona } from '@daytona/sdk';
const daytona = new Daytona();
const sb = await daytona.get('b8625c83-5123-4265-93e6-b80894973f20');
try { await sb.start(); } catch {}
const r = await sb.process.executeCommand(`cd /tmp/HyperBEAM/_build/default/rel/hb && grep -n "console)" bin/hb | head -10`, undefined, undefined, 60);
console.log(r.result);
