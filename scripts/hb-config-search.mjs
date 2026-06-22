import { Daytona } from '@daytona/sdk';
const daytona = new Daytona();
const sb = await daytona.get('b8625c83-5123-4265-93e6-b80894973f20');
try { await sb.start(); } catch {}

const cmd = `
cd /tmp/HyperBEAM
echo "=== Sample config files ===";
find . -maxdepth 3 -name "*.flat" -o -name "config.json" 2>/dev/null | head -20 || true
echo "=== test config.flat ===";
cat test/config.flat 2>/dev/null | head -80 || true
echo "=== config schema / keys ===";
grep -R "enable.*device\|device.*enable\|http_port\|port\|operator\|store" -n src/core/resolver/hb_opts.erl src/core/http/hb_http_server.erl 2>/dev/null | head -40 || true
`;
const r = await sb.process.executeCommand(cmd, undefined, undefined, 60);
console.log(r.result);
