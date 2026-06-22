import { Daytona } from '@daytona/sdk';
const daytona = new Daytona();
const sb = await daytona.get('b8625c83-5123-4265-93e6-b80894973f20');
try { await sb.start(); } catch(e) {}
const r = await sb.process.executeCommand('find /tmp/HyperBEAM/_build/default/rel/hb/lib -maxdepth 3 -type d -name "*reference*" 2\u003e/dev/null; echo ---; find /tmp/HyperBEAM/_build/default/rel/hb/lib/hb-*/ebin -maxdepth 1 -name "*reference*" 2\u003e/dev/null | head; echo ---; curl -s http://localhost:8734/~meta@1.0/info | grep -i reference || true', undefined, undefined, 30);
console.log(r.result);
