import { Daytona } from '@daytona/sdk';
const daytona = new Daytona();
const sb = await daytona.get('b8625c83-5123-4265-93e6-b80894973f20');
try { await sb.start(); } catch(e) {}
const baseEnv = 'PERMABRAIN_TRANSPORT=hyperbeam PERMABRAIN_HYPERBEAM_URL=http://localhost:8734 PERMABRAIN_REQUIRE_HYPERBEAM=1 NODE_OPTIONS="--import ./scripts/hb-json-accept-patch.mjs"';
const r = await sb.process.executeCommand(`cd /tmp/permabrain-insandbox && ${baseEnv} npm test 2>\u00261 | tail -40`, undefined, undefined, 120);
console.log(r.result);
