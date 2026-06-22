import { Daytona } from '@daytona/sdk';
const daytona = new Daytona();
const sb = await daytona.get('b8625c83-5123-4265-93e6-b80894973f20');
try { await sb.start(); } catch(e) {}
const r = await sb.process.executeCommand(`cd /tmp/permabrain-insandbox \u0026\u0026 node -e "
import('./scripts/ref-device-test.mjs').then(()=>{}).catch(()=>{});
" 2\u003e/dev/null; node scripts/ref-device-test.mjs http://localhost:8734 'reference@1.0' 2\u003e/dev/null | sed -n '/id=\"error-text\"/,/\\/pre/p' | head -20`, undefined, undefined, 60);
console.log(r.result);
