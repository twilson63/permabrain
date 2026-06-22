import { Daytona } from '@daytona/sdk';
const daytona = new Daytona();
const sb = await daytona.get('b8625c83-5123-4265-93e6-b80894973f20');
console.log('stopping sandbox...');
try { await sb.stop(); } catch(e) { console.log('stop err', e.message); }
console.log('starting sandbox...');
try { await sb.start(); } catch(e) { console.log('start err', e.message); }
console.log('sandbox started');

// Configure for port 8734
const cfg = 'port: 8734\nnode_host: https://ao.computer\nawait-inprogress: false\n';
await sb.process.executeCommand(`printf '${cfg}' \u003e /tmp/HyperBEAM/config.flat`, undefined, undefined, 30);
await sb.process.executeCommand(`printf '${cfg}' \u003e /tmp/HyperBEAM/_build/default/rel/hb/config.flat`, undefined, undefined, 30);

// Kill any lingering Erlang processes
await sb.process.executeCommand('pkill -f "hb -- -root" || true; pkill -f run_erl || true; pkill -f epmd || true; sleep 3', undefined, undefined, 60);

// Start daemon
await sb.process.executeCommand('cd /tmp/HyperBEAM/_build/default/rel/hb \u0026\u0026 nohup ./bin/hb daemon \u003e /tmp/hb-daemon.log 2\u003e\u00261 \u003c /dev/null \u0026', undefined, undefined, 30);
await new Promise(r => setTimeout(r, 10000));

// Wait for health
const preview = await sb.getSignedPreviewUrl(8734);
console.log('preview url', preview.url);
for (let i = 0; i < 30; i++) {
  const r = await sb.process.executeCommand(`curl -s -o /dev/null -w "%{http_code}" -H 'Accept: application/json' ${preview.url}/~meta@1.0/info`, undefined, undefined, 30);
  const code = r.result.trim();
  console.log(`attempt ${i}: ${code}`);
  if (code === '200') break;
  await new Promise(r => setTimeout(r, 2000));
}
const body = await sb.process.executeCommand(`curl -s -H 'Accept: application/json' ${preview.url}/~meta@1.0/info | head -c 300`, undefined, undefined, 30);
console.log('body', body.result);
