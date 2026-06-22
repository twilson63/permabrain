import { Daytona } from '@daytona/sdk';
const daytona = new Daytona();
const sb = await daytona.get('b8625c83-5123-4265-93e6-b80894973f20');
try { await sb.start(); } catch(e) {}
const r = await sb.process.executeCommand('ps aux | grep -E "hb daemon|beam.smp" | grep -v grep || true; echo ---; cat /tmp/hb-daemon.log 2\u003e/dev/null | tail -60', undefined, undefined, 30);
console.log(r.result);
