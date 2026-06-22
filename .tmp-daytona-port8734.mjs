import { Daytona } from '@daytona/sdk';
const daytona = new Daytona();
const sb = await daytona.get('b8625c83-5123-4265-93e6-b80894973f20');
try { await sb.start(); } catch(e) {}
const cfg = 'port: 8734\nnode_host: https://ao.computer\nawait-inprogress: false\n';
await sb.process.executeCommand(`printf '${cfg}' \u003e /tmp/HyperBEAM/config.flat`, undefined, undefined, 30);
await sb.process.executeCommand(`printf '${cfg}' \u003e /tmp/HyperBEAM/_build/default/rel/hb/config.flat`, undefined, undefined, 30);
await sb.process.executeCommand('pkill -f "beam.smp" || true; sleep 2', undefined, undefined, 30);
await sb.process.executeCommand('cd /tmp/HyperBEAM/_build/default/rel/hb \u0026\u0026 ./bin/hb daemon \u003e /tmp/hb-daemon.log 2\u003e\u00261 \u0026', undefined, undefined, 30);
await new Promise(r => setTimeout(r, 8000));
const preview = await sb.getSignedPreviewUrl(8734);
console.log('url', preview.url);
const health = await sb.process.executeCommand(`curl -s -i -H 'Accept: application/json' ${preview.url}/~meta@1.0/info 2\u003e\u00261 | head -30`, undefined, undefined, 30);
console.log('health', health.result);
