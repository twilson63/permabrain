import { Daytona } from '@daytona/sdk';
const daytona = new Daytona();
const sb = await daytona.get('b8625c83-5123-4265-93e6-b80894973f20');
try { await sb.start(); } catch(e) {}
const preview = await sb.getSignedPreviewUrl(8734);
console.log('url', preview.url);
const ps = await sb.process.executeCommand('ps aux | grep -E "hb daemon|beam.smp" | grep -v grep || true', undefined, undefined, 30);
console.log('processes:', ps.result);
const health = await sb.process.executeCommand(`curl -s -i -H 'Accept: application/json' ${preview.url}/~meta@1.0/info 2\u003e\u00261 | head -30`, undefined, undefined, 30);
console.log('health headers:', health.result);
const body = await sb.process.executeCommand(`curl -s -H 'Accept: application/json' ${preview.url}/~meta@1.0/info 2\u003e\u00261`, undefined, undefined, 30);
console.log('health body:', body.result);
