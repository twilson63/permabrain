import { Daytona } from '@daytona/sdk';
const daytona = new Daytona();
const sb = await daytona.get('b8625c83-5123-4265-93e6-b80894973f20');
try { await sb.start(); } catch(e) {}
const r = await sb.process.executeCommand('curl -s -i -H "Accept: application/json" -H "Content-Type: application/json" -X POST -d \'{\u0022value\u0022:\u0022probe-test\u0022}\' http://localhost:8734/~reference@1.0 2\u003e\u00261 | head -30', undefined, undefined, 30);
console.log(r.result);
