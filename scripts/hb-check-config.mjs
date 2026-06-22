import { Daytona } from '@daytona/sdk';
const daytona = new Daytona();
const sb = await daytona.get('b8625c83-5123-4265-93e6-b80894973f20');
try { await sb.start(); } catch {}
const r = await sb.process.executeCommand(`cat /tmp/hb-daemon.log 2>/dev/null | head -50
echo -- config.flat --
cat /tmp/HyperBEAM/_build/default/rel/hb/config.flat
echo -- default_codec refs --
grep -n "default_codec\|hb_config_location" /tmp/HyperBEAM/src/core/http/hb_http.erl /tmp/HyperBEAM/src/hb_opts.erl 2>/dev/null | head -20`, undefined, undefined, 60);
console.log(r.result);
