import { Daytona } from '@daytona/sdk';
const daytona = new Daytona();
const sb = await daytona.get('b8625c83-5123-4265-93e6-b80894973f20');
try { await sb.start(); } catch(e) {}
const start = await sb.process.executeCommand('cd /tmp/HyperBEAM/_build/default/rel/hb \u0026\u0026 nohup ./bin/hb daemon > /tmp/hb-daemon.log 2>&1 < /dev/null &', undefined, undefined, 30);
console.log('start exit', start.exitCode);
await new Promise(r => setTimeout(r, 10000));
const ps = await sb.process.executeCommand('ps aux | grep -E "hb daemon|beam.smp" | grep -v grep || true; echo ---; cat /tmp/hb-daemon.log | tail -40', undefined, undefined, 30);
console.log(ps.result);
const preview = await sb.getSignedPreviewUrl(8734);
console.log('url', preview.url);
const health = await sb.process.executeCommand(`curl -s -H 'Accept: application/json' ${preview.url}/~meta@1.0/info | head -c 200`, undefined, undefined, 30);
console.log('health', health.result);
