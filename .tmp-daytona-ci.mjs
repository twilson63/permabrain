import { Daytona } from '@daytona/sdk';
const daytona = new Daytona();
const sb = await daytona.get('b8625c83-5123-4265-93e6-b80894973f20');
try { await sb.start(); } catch(e) {}
const r = await sb.process.executeCommand('cd /tmp/HyperBEAM \u0026\u0026 ls .github/workflows/ 2\u003e/dev/null || echo no-workflows; echo ---; find .github -type f -name "*.yml" -o -name "*.yaml" 2\u003e/dev/null | head', undefined, undefined, 30);
console.log(r.result);
