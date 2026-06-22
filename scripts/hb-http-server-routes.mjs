import { Daytona } from '@daytona/sdk';
const daytona = new Daytona();
const sb = await daytona.get('b8625c83-5123-4265-93e6-b80894973f20');
try { await sb.start(); } catch {}

const cmd = `
cd /tmp/HyperBEAM
awk '/new_server/,/^new_server/' src/core/http/hb_http_server.erl | head -200
echo "=== dispatch / cowboy ==="
grep -n "cowboy_router\|compile\|dispatch\|static.*Device\|hb_http:handler" src/core/http/hb_http_server.erl | head -40 || true
echo "=== handler module ==="
ls src/core/http/*.erl | head -20 || true
`;
const r = await sb.process.executeCommand(cmd, undefined, undefined, 60);
console.log(r.result);
