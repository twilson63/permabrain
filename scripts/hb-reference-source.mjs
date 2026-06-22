import { Daytona } from '@daytona/sdk';
const daytona = new Daytona();
const sb = await daytona.get('b8625c83-5123-4265-93e6-b80894973f20');
try { await sb.start(); } catch {}
const r = await sb.process.executeCommand('find /tmp/HyperBEAM/src -name dev_reference.erl', undefined, undefined, 60);
console.log('files:', r.result);
if (r.result.trim()) {
  const r2 = await sb.process.executeCommand('cat ' + r.result.trim(), undefined, undefined, 60);
  console.log(r2.result);
}
