import { Daytona } from '@daytona/sdk';
const daytona = new Daytona();
const sb = await daytona.get('b8625c83-5123-4265-93e6-b80894973f20');
try { await sb.start(); } catch {}
const r = await sb.process.executeCommand(`curl -v -s http://localhost:8734/~meta@1.0/info 2>&1 | head -50`, undefined, undefined, 60);
console.log(r.result);
