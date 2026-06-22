import { Daytona } from '@daytona/sdk';
const daytona = new Daytona();
const sb = await daytona.get('b8625c83-5123-4265-93e6-b80894973f20');
try { await sb.start(); } catch {}
const r = await sb.process.executeCommand(`cd /tmp/HyperBEAM/_build/default/rel/hb && ls -la log/ 2>/dev/null | head -20; echo -- run_erl log --; ls -la /tmp/hb-daemon.log 2>/dev/null; echo -- cwd --; pwd`, undefined, undefined, 60);
console.log(r.result);
