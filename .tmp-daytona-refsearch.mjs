import { Daytona } from '@daytona/sdk';
const daytona = new Daytona();
const sb = await daytona.get('b8625c83-5123-4265-93e6-b80894973f20');
try { await sb.start(); } catch(e) {}
const r = await sb.process.executeCommand('cd /tmp/HyperBEAM \u0026\u0026 grep -R -l "reference@1.0\|dev_reference" --include="*.erl" --include="*.hrl" . 2\u003e/dev/null | head -20', undefined, undefined, 30);
console.log(r.result);
