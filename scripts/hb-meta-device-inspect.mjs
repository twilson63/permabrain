import { Daytona } from '@daytona/sdk';
const daytona = new Daytona();
const sb = await daytona.get('b8625c83-5123-4265-93e6-b80894973f20');
try { await sb.start(); } catch {}

const cmd = `
cd /tmp/HyperBEAM
sed -n '/^-module(dev_meta)/,/^%%% End/p' src/preloaded/node/dev_meta.erl | head -250
`;
const r = await sb.process.executeCommand(cmd, undefined, undefined, 60);
console.log(r.result);
