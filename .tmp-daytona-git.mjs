import { Daytona } from '@daytona/sdk';
const daytona = new Daytona();
const sb = await daytona.get('b8625c83-5123-4265-93e6-b80894973f20');
try { await sb.start(); } catch(e) {}
const cmds = [
  'cd /tmp/HyperBEAM \u0026\u0026 git fetch origin main',
  'cd /tmp/HyperBEAM \u0026\u0026 git log --oneline -5 origin/main',
  'cd /tmp/HyperBEAM \u0026\u0026 git log --oneline -5 HEAD',
  'cd /tmp/HyperBEAM \u0026\u0026 git branch -vv',
];
for (const cmd of cmds) {
  console.log('>>>', cmd);
  const r = await sb.process.executeCommand(cmd, undefined, undefined, 60);
  console.log(r.result);
  console.log('exit', r.exitCode);
}
