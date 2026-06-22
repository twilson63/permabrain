import { Daytona } from '@daytona/sdk';
const daytona = new Daytona();
const sb = await daytona.get('b8625c83-5123-4265-93e6-b80894973f20');
try { await sb.start(); } catch {}

const cmd = `
cd /tmp/HyperBEAM
echo "=== accept_to_codec ===";
grep -n "accept_to_codec" -A 40 src/core/http/hb_http.erl | head -80 || true
echo "=== reply function ===";
grep -n "^reply(" -A 80 src/core/http/hb_http.erl | head -120 || true
`;
const r = await sb.process.executeCommand(cmd, undefined, undefined, 60);
console.log(r.result);
