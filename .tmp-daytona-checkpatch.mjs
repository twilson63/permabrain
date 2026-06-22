import { Daytona } from '@daytona/sdk';
const daytona = new Daytona();
const sb = await daytona.get('b8625c83-5123-4265-93e6-b80894973f20');
try { await sb.start(); } catch(e) {}
const r = await sb.process.executeCommand('ls -la /tmp/permabrain-insandbox/scripts/ 2\u003e/dev/null || echo no-scripts; echo ---; ls -la /tmp/hb-json-accept-patch.mjs 2\u003e/dev/null || echo no-tmp-patch', undefined, undefined, 30);
console.log(r.result);
