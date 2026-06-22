import { Daytona } from '@daytona/sdk';
const daytona = new Daytona();
const sb = await daytona.get('b8625c83-5123-4265-93e6-b80894973f20');
try { await sb.start(); } catch(e) {}
const p1234 = await sb.getSignedPreviewUrl(1234);
console.log('preview 1234:', p1234.url);
const p8734 = await sb.getSignedPreviewUrl(8734);
console.log('preview 8734:', p8734.url);
