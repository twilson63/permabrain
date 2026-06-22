import { Daytona } from '@daytona/sdk';
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';

const daytona = new Daytona();
const sb = await daytona.get('b8625c83-5123-4265-93e6-b80894973f20');
try { await sb.start(); } catch {}
const preview = await sb.getSignedPreviewUrl(8734);
const baseUrl = preview.url;
fs.writeFileSync('/home/node/.openclaw/workspace/.hb-edge-url', baseUrl);
console.log('URL:', baseUrl);

// Test meta info with Accept JSON
const r = spawnSync('curl', ['-s', '-H', 'Accept: application/json', `${baseUrl}/~meta@1.0/info`], { encoding: 'utf8' });
console.log('meta info:', r.stdout.slice(0,200));

// Test reference create with curl
const create = spawnSync('curl', ['-s', '-H', 'Accept: application/json', '-H', 'Content-Type: application/json', '-X', 'POST', '-d', JSON.stringify({key:'value'}), `${baseUrl}/~reference@1.0`], { encoding: 'utf8' });
console.log('reference create:', create.stdout.slice(0,200));

// Test reference resolve
const resolve = spawnSync('curl', ['-s', '-H', 'Accept: application/json', `${baseUrl}/~reference@1.0`], { encoding: 'utf8' });
console.log('reference resolve:', resolve.stdout.slice(0,200));
