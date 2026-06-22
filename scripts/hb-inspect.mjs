import { Daytona } from '@daytona/sdk';
const daytona = new Daytona();
const sb = await daytona.get('b8625c83-5123-4265-93e6-b80894973f20');
try { await sb.start(); } catch {}

const cmd = `
echo "=== Git log ===";
cd /tmp/HyperBEAM && git log --oneline -5 2>/dev/null || true
echo "=== Release files ===";
ls -la /tmp/HyperBEAM/_build/default/rel/hb/releases/0.0.1/ 2>/dev/null || true
echo "=== sys.config ===";
cat /tmp/HyperBEAM/_build/default/rel/hb/releases/0.0.1/sys.config 2>/dev/null | head -120 || true
echo "=== vm.args ===";
cat /tmp/HyperBEAM/_build/default/rel/hb/releases/0.0.1/vm.args 2>/dev/null || true
echo "=== config.flat exists ===";
ls -la /tmp/HyperBEAM/config.flat /tmp/HyperBEAM/_build/default/rel/hb/config.flat 2>/dev/null || true
echo "=== env ===";
env | grep -iE 'HB_|ERL|NODE' | sort || true
`;
const r = await sb.process.executeCommand(cmd, undefined, undefined, 60);
console.log(r.result);
