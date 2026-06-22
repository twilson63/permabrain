import { Daytona } from '@daytona/sdk';
const daytona = new Daytona();
const sb = await daytona.get('b8625c83-5123-4265-93e6-b80894973f20');
try { await sb.start(); } catch(e) {}
const r = await sb.process.executeCommand('cd /tmp/HyperBEAM && ls src/forge && echo ---providers--- && find src/forge -maxdepth 2 -type f -name "*.erl" | head -20', undefined, undefined, 30);
console.log(r.result);
