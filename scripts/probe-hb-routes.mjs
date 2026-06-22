import { Daytona } from '@daytona/sdk';
const daytona = new Daytona();
const sb = await daytona.get('b8625c83-5123-4265-93e6-b80894973f20');
try { await sb.start(); } catch {}

const endpoints = [
  'http://localhost:8734/~meta@1.0/info',
  'http://localhost:8734/~meta@1.0/info/',
  'http://localhost:8734/~meta@1.0',
  'http://localhost:8734/info',
  'http://localhost:8734/~info@1.0',
  'http://localhost:8734/api/v1/info',
  'http://localhost:8734/',
  'http://localhost:8734/graphql',
  'http://localhost:8734/~bundler@1.0/tx?codec-device=ans104@1.0',
  'http://localhost:8734/~query@1.0?App-Name=PermaBrain&return=boolean',
  'http://localhost:8734/~match@1.0/App-Name=PermaBrain',
  'http://localhost:8734/~reference@1.0',
];

const curl = endpoints.map(u => `echo "=== ${u} ==="; curl -s -o /tmp/body -w "status=%{http_code} content-type=%{content_type} size=%{size_download}\\n" "${u}"; echo "body:"; head -c 400 /tmp/body; echo; echo`).join('\n');
const r = await sb.process.executeCommand(curl, undefined, undefined, 60);
console.log(r.result);
