import { Daytona } from '@daytona/sdk';
import fs from 'node:fs';
const daytona = new Daytona();
const sbId = fs.readFileSync('/home/node/.openclaw/workspace/.hb-fresh-edge-sandbox-id.log', 'utf8').trim();
const sb = await daytona.get(sbId);
try { await sb.stop(); } catch(e) { console.log('stop error', e.message); }
console.log('stopped', sbId);
