import { Daytona } from '@daytona/sdk';
const daytona = new Daytona();
const sb = await daytona.get('b8625c83-5123-4265-93e6-b80894973f20');
try { await sb.start(); } catch(e) {}
const r = await sb.process.executeCommand('cd /tmp/HyperBEAM \u0026\u0026 ls Makefile 2\u003e/dev/null \u0026\u0026 cat Makefile 2\u003e/dev/null | head -40', undefined, undefined, 60);
console.log(r.result);
console.log('exit', r.exitCode);
