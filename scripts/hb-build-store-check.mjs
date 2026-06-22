import { Daytona } from '@daytona/sdk';
const daytona = new Daytona();
const sb = await daytona.get('b8625c83-5123-4265-93e6-b80894973f20');
try { await sb.start(); } catch {}
const r = await sb.process.executeCommand(`cd /tmp/HyperBEAM && rm -rf _build/preloaded-store && escript scripts/build-preloaded-store.escript 2>&1 | grep -iE "bundler|error|warn" | head -40`, undefined, undefined, 120);
console.log(r.result);
