import { Daytona } from '@daytona/sdk';
const daytona = new Daytona();
const sb = await daytona.get('b8625c83-5123-4265-93e6-b80894973f20');
try { await sb.start(); } catch {}
const cmd = `ps aux | grep -E "hb|beam" | grep -v grep || true; echo "---LOG---"; ls -la /tmp/hb-daemon.log 2>/dev/null || true; echo "---TAIL---"; tail -50 /tmp/hb-daemon.log 2>/dev/null || true; echo "---END---"`;
const r = await sb.process.executeCommand(cmd, undefined, undefined, 60);
console.log(r.result || '(no result)', 'exit', r.exitCode);
