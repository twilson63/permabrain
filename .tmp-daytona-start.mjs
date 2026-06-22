import { Daytona } from '@daytona/sdk';
const daytona = new Daytona();
const sb = await daytona.get('b8625c83-5123-4265-93e6-b80894973f20');
try { await sb.start(); } catch(e) {}
await sb.process.executeCommand('cd /tmp/HyperBEAM \u0026\u0026 cp test/config.flat config.flat 2\u003e/dev/null || true', undefined, undefined, 30);
const flags = '-Wno-error -Wno-incompatible-pointer-types -Wno-pointer-sign';
const build = await sb.process.executeCommand(`cd /tmp/HyperBEAM \u0026\u0026 export CFLAGS="${flags}" \u0026\u0026 export CXXFLAGS="${flags}" \u0026\u0026 rebar3 release 2\u003e\u00261 | tail -30`, undefined, undefined, 300);
console.log(build.result);
console.log('build exit', build.exitCode);

await sb.process.executeCommand('pkill -f "hb daemon" || true; sleep 2', undefined, undefined, 30);
await sb.process.executeCommand('cd /tmp/HyperBEAM/_build/default/rel/hb \u0026\u0026 ./bin/hb daemon > /tmp/hb-daemon.log 2>&1 &', undefined, undefined, 30);
await new Promise(r => setTimeout(r, 8000));
const preview = await sb.getSignedPreviewUrl(8734);
console.log('url', preview.url);
const health = await sb.process.executeCommand(`curl -s -H 'Accept: application/json' ${preview.url}/~meta@1.0/info | head -c 200`, undefined, undefined, 30);
console.log('health', health.result);
