import { Daytona } from '@daytona/sdk';
const daytona = new Daytona();
const sb = await daytona.get('b8625c83-5123-4265-93e6-b80894973f20');
try { await sb.start(); } catch(e) {}
const r = await sb.process.executeCommand('cd /tmp/HyperBEAM && wc -l src/core/device/hb_device_load.erl && sed -n "95,170p" src/core/device/hb_device_load.erl', undefined, undefined, 30);
console.log(r.result);
