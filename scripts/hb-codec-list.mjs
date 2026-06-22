import { Daytona } from '@daytona/sdk';
const daytona = new Daytona();
const sb = await daytona.get('b8625c83-5123-4265-93e6-b80894973f20');
try { await sb.start(); } catch {}
const r = await sb.process.executeCommand(`cd /tmp/HyperBEAM && ls -la _build/preloaded-store 2>/dev/null; ls -la _build/default/rel/hb/priv/preloaded* 2>/dev/null; ls -la priv/preloaded* 2>/dev/null; find _build/default/lib/hb/priv -maxdepth 2 -type d 2>/dev/null | head`, undefined, undefined, 60);
console.log(r.result);
