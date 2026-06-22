import { Daytona } from '@daytona/sdk';
const daytona = new Daytona();
const sb = await daytona.get('b8625c83-5123-4265-93e6-b80894973f20');
try { await sb.start(); } catch {}
const cmds = [
  '/tmp/HyperBEAM/_build/default/rel/hb/bin/hb stop 2>&1 || true',
  'pkill -f "hb daemon" 2>/dev/null || true',
  'pkill -9 -f "beam.smp" 2>/dev/null || true',
  'sleep 2',
  'ps aux | grep beam | grep -v grep || echo no-beam'
];
for (const cmd of cmds) {
  try {
    const r = await sb.process.executeCommand(cmd, undefined, undefined, 30);
    console.log(`$ ${cmd}\n${r.result}`);
  } catch (e) {
    console.error(`$ ${cmd} -> ${e.message}`);
  }
}
