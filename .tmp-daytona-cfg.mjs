import { Daytona } from '@daytona/sdk';
const daytona = new Daytona();
const sb = await daytona.get('b8625c83-5123-4265-93e6-b80894973f20');
try { await sb.start(); } catch(e) {}
const r = await sb.process.executeCommand('cat /tmp/HyperBEAM/test/config.flat 2\u003e/dev/null | head -40; echo ---app.config---; grep -n port /tmp/HyperBEAM/config/app.config 2\u003e/dev/null | head', undefined, undefined, 30);
console.log(r.result);
