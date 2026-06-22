import { Daytona } from '@daytona/sdk';
const daytona = new Daytona();
const sb = await daytona.get('b8625c83-5123-4265-93e6-b80894973f20');
try { await sb.start(); } catch(e) {}
const r = await sb.process.executeCommand('cd /tmp/HyperBEAM/_build/default/rel/hb \u0026\u0026 timeout 10 ./bin/hb daemon 2\u003e\u00261 | tail -80 || true', undefined, undefined, 30);
console.log(r.result);
console.log('exit', r.exitCode);
