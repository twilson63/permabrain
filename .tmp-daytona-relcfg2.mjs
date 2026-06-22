import { Daytona } from '@daytona/sdk';
const daytona = new Daytona();
const sb = await daytona.get('b8625c83-5123-4265-93e6-b80894973f20');
try { await sb.start(); } catch(e) {}
const r = await sb.process.executeCommand('ls -la /tmp/HyperBEAM/_build/default/rel/hb/config.flat 2\u003e/dev/null || echo no-rel-flat; echo ---; cat /tmp/HyperBEAM/_build/default/rel/hb/config.flat 2\u003e/dev/null | head', undefined, undefined, 30);
console.log(r.result);
