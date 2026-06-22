import { Daytona } from '@daytona/sdk';
import fs from 'node:fs';
const daytona = new Daytona();
const sb = await daytona.get('b8625c83-5123-4265-93e6-b80894973f20');
try { await sb.start(); } catch {}
const p = await sb.getSignedPreviewUrl(8734);
fs.writeFileSync('.hb-edge-url', p.url);
console.log(p.url);
