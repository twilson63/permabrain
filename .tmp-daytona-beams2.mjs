import { Daytona } from '@daytona/sdk';
const daytona = new Daytona();
const sb = await daytona.get('b8625c83-5123-4265-93e6-b80894973f20');
try { await sb.start(); } catch(e) {}
const r = await sb.process.executeCommand('ls /tmp/HyperBEAM/_build/default/lib/hb/ebin | grep dev_ | sort', undefined, undefined, 30);
console.log(r.result);
