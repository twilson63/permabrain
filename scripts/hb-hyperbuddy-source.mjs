import { Daytona } from '@daytona/sdk';
const daytona = new Daytona();
const sb = await daytona.get('b8625c83-5123-4265-93e6-b80894973f20');
try { await sb.start(); } catch {}

const cmd = `
cd /tmp/HyperBEAM
echo "=== hyperbuddy references in source ===";
grep -R "hyperbuddy\|Hyperbuddy\|ui\|frontend\|static" -n src/ 2>/dev/null | head -60 || true
echo "=== meta@1.0 device ===";
find src -name "*meta*" -type f 2>/dev/null | head -20 || true
ls src/devices/ 2>/dev/null | head -40 || true
`;
const r = await sb.process.executeCommand(cmd, undefined, undefined, 60);
console.log(r.result);
