import { Daytona } from '@daytona/sdk';
const daytona = new Daytona();
const sb = await daytona.get('b8625c83-5123-4265-93e6-b80894973f20');
try { await sb.start(); } catch(e) {}
const cmds = [
  'ls -la /tmp/HyperBEAM/_build/default/rel/hb/bin/hb 2\u003e/dev/null \u0026\u0026 echo binary-exists || echo no-binary',
  'ls -la /tmp/HyperBEAM/config.flat 2\u003e/dev/null || echo no-config-flat',
  'ls /tmp/HyperBEAM/config/ 2\u003e/dev/null | head',
  'find /tmp/HyperBEAM -maxdepth 2 -name "*.flat" 2\u003e/dev/null | head',
];
for (const cmd of cmds) {
  console.log('>>>', cmd);
  const r = await sb.process.executeCommand(cmd, undefined, undefined, 30);
  console.log(r.result);
}
