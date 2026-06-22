import { Daytona } from '@daytona/sdk';
const daytona = new Daytona();
const sb = await daytona.get('b8625c83-5123-4265-93e6-b80894973f20');
try { await sb.start(); } catch {}

const cmd = `
cd /tmp/HyperBEAM
sed -n '/^new_server(/,/^%%% Tests/p' src/core/http/hb_http_server.erl | head -220
`;
const r = await sb.process.executeCommand(cmd, undefined, undefined, 60);
console.log(r.result);
