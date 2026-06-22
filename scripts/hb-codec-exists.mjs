import { Daytona } from '@daytona/sdk';
const daytona = new Daytona();
const sb = await daytona.get('b8625c83-5123-4265-93e6-b80894973f20');
try { await sb.start(); } catch {}

const cmd = `
cd /tmp/HyperBEAM
echo "=== json codec device ===";
find src -name "*json*" -type f | head -20 || true
ls src/preloaded/codecs/ 2>/dev/null | head -30 || true
ls src/devices/ 2>/dev/null | head -30 || true
grep -R "default_codec" -n src/ | head -20 || true
`;
const r = await sb.process.executeCommand(cmd, undefined, undefined, 60);
console.log(r.result);
