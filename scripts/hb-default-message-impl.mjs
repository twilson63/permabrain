import { Daytona } from '@daytona/sdk';
const daytona = new Daytona();
const sb = await daytona.get('b8625c83-5123-4265-93e6-b80894973f20');
try { await sb.start(); } catch {}
const r = await sb.process.executeCommand(`cd /tmp/HyperBEAM && sed -n '/^default_message(/,/^default_message_with_env/p' src/core/resolver/hb_opts.erl | head -120`, undefined, undefined, 60);
console.log(r.result);
