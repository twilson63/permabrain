import { Daytona } from '@daytona/sdk';
const daytona = new Daytona();
const sb = await daytona.get('b8625c83-5123-4265-93e6-b80894973f20');
try { await sb.start(); } catch(e) {}
const r = await sb.process.executeCommand('curl -s -i -H "Accept: application/json" http://localhost:1234/~meta@1.0/info 2\u003e\u00261 | head -40', undefined, undefined, 30);
console.log(r.result);
