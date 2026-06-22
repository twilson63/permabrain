import { Daytona } from '@daytona/sdk';
const daytona = new Daytona();
const sb = await daytona.get('b8625c83-5123-4265-93e6-b80894973f20');
try { await sb.start(); } catch(e) {}
const r = await sb.process.executeCommand('ls /tmp/HyperBEAM/_build/default/rel/hb/lib/ | head; echo ---ebin---; ls /tmp/HyperBEAM/_build/default/rel/hb/lib/hb-*/ebin 2\u003e/dev/null | head -20; echo ---preloaded---; find /tmp/HyperBEAM/_build/default/lib -maxdepth 3 -name "dev_reference*" -o -name "*reference*" 2\u003e/dev/null | head', undefined, undefined, 30);
console.log(r.result);
