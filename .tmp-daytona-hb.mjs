import { Daytona } from '@daytona/sdk';
const daytona = new Daytona();
const sb = await daytona.get('b8625c83-5123-4265-93e6-b80894973f20');
try { await sb.start(); } catch(e) {}
const cmds = [
  'cd /tmp/HyperBEAM/_build/default/rel/hb \u0026\u0026 ./bin/hb version 2\u003e\u00261 || true',
  'cd /tmp/HyperBEAM/_build/default/rel/hb \u0026\u0026 ./bin/hb help 2\u003e\u00261 | head -40 || true',
  'cd /tmp/HyperBEAM/_build/default/rel/hb \u0026\u0026 ls -la log/ 2\u003e/dev/null || true',
];
for (const cmd of cmds) {
  console.log('\u003e\u003e\u003e', cmd);
  const r = await sb.process.executeCommand(cmd, undefined, undefined, 30);
  console.log(r.result);
}
