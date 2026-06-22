import { Daytona } from '@daytona/sdk';
const daytona = new Daytona();
const sb = await daytona.get('b8625c83-5123-4265-93e6-b80894973f20');
try { await sb.start(); } catch {}

const cmd = `
cd /tmp/HyperBEAM
echo "=== hb_http.erl top exports ===";
head -60 src/core/http/hb_http.erl
echo "=== hb_http.erl cowboy callbacks ===";
grep -n "-export\|init(\|allowed_methods\|content_types\|handle" src/core/http/hb_http.erl | head -60 || true
echo "=== set_default_opts ===";
sed -n '/set_default_opts/,/^\s*end\./p' src/core/http/hb_http_server.erl | head -80 || true
`;
const r = await sb.process.executeCommand(cmd, undefined, undefined, 60);
console.log(r.result);
