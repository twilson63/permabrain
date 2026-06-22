import { Daytona } from '@daytona/sdk';
const daytona = new Daytona();
const sb = await daytona.get('b8625c83-5123-4265-93e6-b80894973f20');
try { await sb.start(); } catch(e) {}
const r = await sb.process.executeCommand('ps aux | grep -E "hb|beam|run_erl|epmd" | grep -v grep || true; echo ---LOG---; cat /tmp/hb-daemon.log 2\u003e/dev/null | tail -60; echo ---RUN-ERL---; cat /tmp/HyperBEAM/_build/default/rel/hb/log/run_erl.log 2\u003e/dev/null | tail -20; echo ---NET---; netstat -tlnp 2\u003e/dev/null | grep -E "8734|1234" || ss -tlnp 2\u003e/dev/null | grep -E "8734|1234" || true', undefined, undefined, 60);
console.log(r.result);
