import { Daytona } from '@daytona/sdk';
const daytona = new Daytona();
const sb = await daytona.get('b8625c83-5123-4265-93e6-b80894973f20');
try { await sb.start(); } catch(e) {}
const r = await sb.process.executeCommand('which node || echo no-node; node --version 2\u003e\u00261 || true; which npm || echo no-npm', undefined, undefined, 30);
console.log(r.result);
