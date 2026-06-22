import { Daytona } from '@daytona/sdk';
const daytona = new Daytona();
const sb = await daytona.get('b8625c83-5123-4265-93e6-b80894973f20');
try { await sb.start(); } catch {}

const cmd = `
cd /tmp/HyperBEAM
echo "=== HTTP server routes / static ===";
grep -R "hyperbuddy\|Hyperbuddy\|static\|priv_dir" -l src/ 2>/dev/null | head -20 || true
echo "=== Default device handlers ===";
grep -R "~meta@1.0\|meta@1.0\|device.*info\|default.*handler" -l src/ 2>/dev/null | head -20 || true
echo "=== hb_http_server route table ===";
grep -n "cowboy_router\|compile\|routes\|priv_dir\|hb_http_server" src/core/http/hb_http_server.erl 2>/dev/null | head -40 || true
echo "=== search for config.flat ===";
grep -R "config.flat" -n src/ scripts/ rebar.config 2>/dev/null | head -20 || true
`;
const r = await sb.process.executeCommand(cmd, undefined, undefined, 60);
console.log(r.result);
