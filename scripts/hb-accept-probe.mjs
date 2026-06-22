import { Daytona } from '@daytona/sdk';
const daytona = new Daytona();
const sb = await daytona.get('b8625c83-5123-4265-93e6-b80894973f20');
try { await sb.start(); } catch {}

const cmd = `
echo "=== Accept: application/json ===";
curl -s -H 'Accept: application/json' -o /tmp/body -w "status=%{http_code} ct=%{content_type}\\n" http://localhost:8734/~meta@1.0/info
head -c 300 /tmp/body; echo
echo "=== Accept: application/aos-2 ===";
curl -s -H 'Accept: application/aos-2' -o /tmp/body -w "status=%{http_code} ct=%{content_type}\\n" http://localhost:8734/~meta@1.0/info
head -c 300 /tmp/body; echo
echo "=== Query codec-device=ans104@1.0 ===";
curl -s -o /tmp/body -w "status=%{http_code} ct=%{content_type}\\n" "http://localhost:8734/~meta@1.0/info?codec-device=ans104@1.0"
head -c 300 /tmp/body; echo
echo "=== curl -v meta info (no follow) ===";
curl -v -s http://localhost:8734/~meta@1.0/info 2>&1 | head -40
`;
const r = await sb.process.executeCommand(cmd, undefined, undefined, 60);
console.log(r.result);
