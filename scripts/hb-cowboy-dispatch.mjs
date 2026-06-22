import { Daytona } from '@daytona/sdk';
const daytona = new Daytona();
const sb = await daytona.get('b8625c83-5123-4265-93e6-b80894973f20');
try { await sb.start(); } catch {}

const cmd = `
cd /tmp/HyperBEAM
echo "=== cowboy dispatch / handler references ===";
grep -R "cowboy_handler\|cowboy_router:compile\|Dispatch\|dispatch\|hb_http_handler\|hb_http_server" -n src/core/http/ src/ 2>/dev/null | head -60 || true
echo "=== search for hyperbuddy routing ===";
grep -R "hyperbuddy\|priv_dir.*html\|html/" -n src/ 2>/dev/null | head -30 || true
echo "=== priv/html dir ===";
ls -R priv/html/ 2>/dev/null | head -30 || true
`;
const r = await sb.process.executeCommand(cmd, undefined, undefined, 60);
console.log(r.result);
