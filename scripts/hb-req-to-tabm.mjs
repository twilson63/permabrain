import { Daytona } from '@daytona/sdk';
const daytona = new Daytona();
const sb = await daytona.get('b8625c83-5123-4265-93e6-b80894973f20');
try { await sb.start(); } catch {}
const r = await sb.process.executeCommand(`cd /tmp/HyperBEAM && sed -n '/^req_to_tabm_singleton/,/^parse_url_encoded/p' src/core/http/hb_http.erl | head -120`, undefined, undefined, 60);
console.log(r.result);
