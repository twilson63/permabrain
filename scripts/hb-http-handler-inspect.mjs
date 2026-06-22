import { Daytona } from '@daytona/sdk';
const daytona = new Daytona();
const sb = await daytona.get('b8625c83-5123-4265-93e6-b80894973f20');
try { await sb.start(); } catch {}

const cmd = `
cd /tmp/HyperBEAM
echo "=== hb_http.erl init/handler ===";
grep -n "init(\|allowed_methods\|content_types_accepted\|content_types_provided\|handle\|to_html\|to_json\|from_http\|set_default_opts" src/core/http/hb_http.erl | head -50 || true
echo "=== content negotiation ===";
grep -n "content-type\|accept\|text/html\|application/json\|aos" src/core/http/hb_http.erl | head -40 || true
echo "=== default opts ===";
grep -n "set_default_opts" src/core/http/hb_http_server.erl -A 60 | head -80 || true
`;
const r = await sb.process.executeCommand(cmd, undefined, undefined, 60);
console.log(r.result);
