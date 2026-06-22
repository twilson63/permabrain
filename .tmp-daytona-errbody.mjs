import { Daytona } from '@daytona/sdk';
const daytona = new Daytona();
const sb = await daytona.get('b8625c83-5123-4265-93e6-b80894973f20');
try { await sb.start(); } catch(e) {}
const r = await sb.process.executeCommand(`cd /tmp/permabrain-insandbox \u0026\u0026 node scripts/ref-device-test.mjs http://localhost:8734 'reference@1.0' 2\u003e\u00261 | grep -A20 'Error details' || node scripts/ref-device-test.mjs http://localhost:8734 'reference@1.0' 2\u003e\u00261 | tail -30`, undefined, undefined, 60);
console.log(r.result);
