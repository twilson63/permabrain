import { Daytona } from '@daytona/sdk';
const daytona = new Daytona();
const sb = await daytona.get('b8625c83-5123-4265-93e6-b80894973f20');
try { await sb.start(); console.log('started'); } catch(e) { console.log('start error:', e.message); }
const r = await sb.process.executeCommand('cd /tmp/HyperBEAM && git rev-parse --short HEAD && git status --short && ls -d _build/default/rel/hb 2>/dev/null && echo built || echo not-built', undefined, undefined, 60);
console.log('result:', r.result, 'exit:', r.exitCode);
