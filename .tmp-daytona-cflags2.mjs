import { Daytona } from '@daytona/sdk';
const daytona = new Daytona();
const sb = await daytona.get('b8625c83-5123-4265-93e6-b80894973f20');
try { await sb.start(); } catch(e) {}
const flags = '-Wno-error -Wno-incompatible-pointer-types -Wno-pointer-sign';
const r = await sb.process.executeCommand(`cd /tmp/HyperBEAM \u0026\u0026 export CFLAGS="${flags}" \u0026\u0026 export CXXFLAGS="${flags}" \u0026\u0026 rebar3 release 2\u003e\u00261 | tail -120`, undefined, undefined, 600);
console.log(r.result.slice(-4000));
console.log('exit', r.exitCode);
