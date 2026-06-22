import { Daytona } from '@daytona/sdk';
const daytona = new Daytona();
const sb = await daytona.get('b8625c83-5123-4265-93e6-b80894973f20');
try { await sb.start(); } catch(e) {}
const r = await sb.process.executeCommand('netstat -tlnp 2>/dev/null | grep 1234 || ss -tlnp 2>/dev/null | grep 1234 || echo "no netstat"', undefined, undefined, 30);
console.log(r.result);
